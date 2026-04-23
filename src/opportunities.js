// ============================================================
// Opportunities tracker: acumula items reservados a lo largo del
// tiempo, agrupa por modelo (título normalizado) y genera tiers
// de confianza basados en volumen SOSTENIDO (no solo picos 24h).
//
// Tiers (orden de prioridad):
//   🚀 proven_seller  → ≥5 reservas en 7d O ≥10 reservas en 30d
//                       (mercado vivo con venta recurrente)
//   🔥 hot_24h        → ≥3 reservas en 24h (pico de demanda)
//   ✨ trending_7d    → ≥3 reservas en 7d (demanda consistente)
//   📈 recurring      → ≥2 reservas en 30d (señal repetida)
//   💡 possible       → 1 reserva (señal puntual)
// ============================================================

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const HISTORY_FILE = path.join(DATA_DIR, "reservations_history.json");
const OPPORTUNITIES_FILE = path.join(DATA_DIR, "opportunities.json");
const SALES_FILE = path.join(DATA_DIR, "confirmed_sales.json");
const TIER_STATE_FILE = path.join(DATA_DIR, "tier_state.json");

// Orden de tiers (ascendente de confianza): si un modelo sube a un tier
// con mayor rank que el anterior, se emite tier_up.
const TIER_RANK = {
  none: 0,
  possible: 1,
  recurring: 2,
  trending_7d: 3,
  hot_24h: 4,
  proven_seller: 5,
};
const TIER_LABEL = {
  possible: "💡 Posible",
  recurring: "📈 Recurring",
  trending_7d: "✨ Trending 7d",
  hot_24h: "🔥 Hot 24h",
  proven_seller: "🚀 Proven seller",
};

// Grace period: si un item estuvo reservado y lleva >N horas sin aparecer
// en ningún fetch, lo damos por VENDIDO. Tiempo corto confunde con glitches
// de paginación API; demasiado largo retrasa el catálogo.
const SALE_GRACE_MS = 2 * 60 * 60 * 1000;   // 2 horas

const HORIZON_24H = 24 * 60 * 60 * 1000;
const HORIZON_7D = 7 * 24 * 60 * 60 * 1000;
const HORIZON_30D = 30 * 24 * 60 * 60 * 1000;
const RETENTION_30D = HORIZON_30D;

// Umbrales de tier (ajustables). La idea: priorizar volumen sostenido
// (7d/30d) sobre picos puntuales (24h) para filtrar modelos que REALMENTE
// se venden con regularidad, no solo los que tuvieron un día bueno.
//
// MODO INCUBACIÓN: durante los primeros 14 días desde que arrancó el
// tracker, los umbrales son más relajados para que aparezcan resultados
// tempranos. A partir de día 14 pasan a los valores "mature".
// Se calcula automáticamente leyendo first_seen más antiguo del history.
const INCUBATION_DAYS = 14;
const THRESHOLDS_INCUBATION = { proven_7d: 3, proven_30d: 5,  hot_24h: 2, trending_7d: 2, recurring_30d: 2 };
const THRESHOLDS_MATURE     = { proven_7d: 5, proven_30d: 10, hot_24h: 3, trending_7d: 3, recurring_30d: 2 };

function pickThresholds(history) {
  if (!history.reservations.length) return THRESHOLDS_INCUBATION;
  const oldest = history.reservations
    .map(r => new Date(r.first_seen).getTime())
    .reduce((a,b) => Math.min(a,b), Date.now());
  const ageDays = (Date.now() - oldest) / (24 * 60 * 60 * 1000);
  return ageDays >= INCUBATION_DAYS ? THRESHOLDS_MATURE : THRESHOLDS_INCUBATION;
}

// Normaliza un título para agrupar items equivalentes.
// - minúsculas, sin acentos
// - quita símbolos y palabras de ruido ("en venta", "nuevo", "vintage", etc.)
// - colapsa espacios
function normalizeModel(title) {
  const stopwords = [
    "nuevo", "nueva", "original", "oferta", "chollo", "barato",
    "impecable", "como", "regalo", "envio", "negociable", "vendo",
    "se", "de", "el", "la", "los", "las", "con", "sin", "y", "o",
    "a", "en", "del", "por", "para", "un", "una", "al",
  ];
  let t = (title || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s#]/g, " ")
    .split(/\s+/)
    .filter(w => w && w.length >= 2 && !stopwords.includes(w))
    .join(" ")
    .trim();
  return t.slice(0, 80);
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return { reservations: [] };
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); }
  catch { return { reservations: [] }; }
}

function saveHistory(h) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2), "utf8");
}

function loadSales() {
  if (!fs.existsSync(SALES_FILE)) return { sales: [] };
  try { return JSON.parse(fs.readFileSync(SALES_FILE, "utf8")); }
  catch { return { sales: [] }; }
}
function saveSales(s) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SALES_FILE, JSON.stringify(s, null, 2), "utf8");
}

function loadTierState() {
  if (!fs.existsSync(TIER_STATE_FILE)) return { models: {} };
  try { return JSON.parse(fs.readFileSync(TIER_STATE_FILE, "utf8")); }
  catch { return { models: {} }; }
}
function saveTierState(t) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TIER_STATE_FILE, JSON.stringify(t, null, 2), "utf8");
}

// Registra los reservados vistos en este run y detecta DESAPARICIONES
// (reservados previos que ya no aparecen en ningún fetch → probable venta).
//
//   reservedItems  → items con reserved=true en este run
//   allFetchedIds  → Set de TODOS los IDs fetched en este run (reservados + activos)
//
// Retorna { history, newSales: [...] } para que el caller pueda notificar.
function appendRun(reservedItems, allFetchedIds = new Set()) {
  const history = loadHistory();
  const sales = loadSales();
  const now = Date.now();

  // 1. Añadir o actualizar reservados vistos ahora
  const existing = new Map(history.reservations.map(r => [r.id, r]));
  for (const it of reservedItems) {
    if (existing.has(it.id)) {
      existing.get(it.id).last_seen = new Date(now).toISOString();
      continue;
    }
    const rec = {
      id: it.id,
      title: it.title,
      model: normalizeModel(it.title),
      price: it.price,
      city: it.city,
      url: it.url,
      category: it.category || null,
      first_seen: new Date(now).toISOString(),
      last_seen: new Date(now).toISOString(),
    };
    history.reservations.push(rec);
    existing.set(rec.id, rec);
  }

  // 2. Detectar desapariciones: items reservados previamente que NO aparecen
  //    en este run (ni reservados ni activos) y llevan > SALE_GRACE_MS sin verse.
  const newSales = [];
  const kept = [];
  for (const r of history.reservations) {
    const seenNow = allFetchedIds.has(r.id);
    const lastSeenMs = new Date(r.last_seen || r.first_seen).getTime();
    const missingMs = now - lastSeenMs;
    if (!seenNow && missingMs >= SALE_GRACE_MS) {
      // VENTA CONFIRMADA (inferida)
      const sale = {
        id: r.id,
        model: r.model,
        title: r.title,
        sold_price: r.price,
        city: r.city,
        url: r.url,
        category: r.category,
        first_reserved: r.first_seen,
        last_seen: r.last_seen || r.first_seen,
        confirmed_at: new Date(now).toISOString(),
      };
      sales.sales.push(sale);
      newSales.push(sale);
    } else {
      kept.push(r);
    }
  }
  history.reservations = kept;

  // 3. Purge history antiguo (>30 días)
  const cutoff = now - RETENTION_30D;
  history.reservations = history.reservations.filter(r => new Date(r.first_seen).getTime() >= cutoff);
  // Purge sales antiguas (>90 días, para catálogo)
  const salesCutoff = now - 90 * 24 * 60 * 60 * 1000;
  sales.sales = sales.sales.filter(s => new Date(s.confirmed_at).getTime() >= salesCutoff);

  saveHistory(history);
  saveSales(sales);
  return { history, sales, newSales };
}

// Agrupa por modelo normalizado y genera los tiers.
// Combina reservas vistas + ventas confirmadas (desaparecidas tras reserva).
function computeOpportunities(history, sales = { sales: [] }) {
  const now = Date.now();
  const T = pickThresholds(history);
  const groups = new Map();
  for (const r of history.reservations) {
    const key = r.model;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { model: key, items: [], sales: [] });
    groups.get(key).items.push(r);
  }
  // Agregar ventas confirmadas al grupo correspondiente
  for (const s of (sales.sales || [])) {
    const key = s.model;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { model: key, items: [], sales: [] });
    groups.get(key).sales = groups.get(key).sales || [];
    groups.get(key).sales.push(s);
  }

  const tiered = {
    proven_seller: [],
    hot_24h: [],
    trending_7d: [],
    recurring: [],
    possible: [],
  };

  for (const [key, group] of groups) {
    const items = (group.items || []).sort((a,b) => new Date(a.first_seen) - new Date(b.first_seen));
    const salesArr = (group.sales || []).sort((a,b) => new Date(a.confirmed_at) - new Date(b.confirmed_at));

    // Eventos totales = reservas activas + ventas confirmadas (más robusto)
    const events = [
      ...items.map(i => ({ ts: i.first_seen, kind: "reserved", price: i.price })),
      ...salesArr.map(s => ({ ts: s.confirmed_at, kind: "sold", price: s.sold_price })),
    ];
    const last24h = events.filter(e => now - new Date(e.ts).getTime() <= HORIZON_24H);
    const last7d  = events.filter(e => now - new Date(e.ts).getTime() <= HORIZON_7D);
    const last30d = events.filter(e => now - new Date(e.ts).getTime() <= HORIZON_30D);
    const prices = events.map(e => e.price).filter(p => p > 0).sort((a,b)=>a-b);
    const median = prices.length ? prices[Math.floor(prices.length/2)] : null;
    const min = prices[0] || null;
    const max = prices[prices.length-1] || null;

    // Frecuencia: eventos por día dentro de la ventana en que existe el modelo
    const allEventsSorted = events.sort((a,b) => new Date(a.ts) - new Date(b.ts));
    const firstEvent = allEventsSorted[0];
    const lastEvent = allEventsSorted[allEventsSorted.length - 1];
    const spanMs = Math.max(1, new Date(lastEvent.ts) - new Date(firstEvent.ts));
    const spanDays = spanMs / (24 * 60 * 60 * 1000);
    const perDay = spanDays > 0 ? (events.length / Math.max(spanDays, 1)) : events.length;

    // Ejemplo y muestra: priorizamos items activos (tienen URL funcional);
    // si solo hay ventas, mostramos la última venta.
    const exampleSource = items.length ? items[items.length-1] : salesArr[salesArr.length-1];

    const entry = {
      model: key,
      example_title: exampleSource.title,
      example_url: exampleSource.url,
      total_reservations: items.length,
      confirmed_sales: salesArr.length,
      total_events: events.length,              // reservas + ventas
      reservations_24h: last24h.length,
      reservations_7d: last7d.length,
      reservations_30d: last30d.length,
      reservations_per_day: Math.round(perDay * 100) / 100,
      min_price: min,
      median_price: median,
      max_price: max,
      first_seen: firstEvent.ts,
      last_seen: lastEvent.ts,
      sample: (items.length ? items.slice(-3) : salesArr.slice(-3)).map(i => ({
        price: i.price || i.sold_price,
        title: i.title,
        url: i.url,
        city: i.city,
      })),
    };

    // Asignación de tier en orden descendente de confianza.
    // Cada modelo cae en EXACTAMENTE UN tier (el más alto que cumpla).
    if (entry.reservations_7d >= T.proven_7d || entry.reservations_30d >= T.proven_30d) {
      tiered.proven_seller.push(entry);
    } else if (entry.reservations_24h >= T.hot_24h) {
      tiered.hot_24h.push(entry);
    } else if (entry.reservations_7d >= T.trending_7d) {
      tiered.trending_7d.push(entry);
    } else if (entry.reservations_30d >= T.recurring_30d) {
      tiered.recurring.push(entry);
    } else {
      tiered.possible.push(entry);
    }
  }

  // Orden dentro de cada tier: prioriza volumen reciente.
  const byRelevance = (a,b) =>
    (b.reservations_7d - a.reservations_7d) ||
    (b.reservations_30d - a.reservations_30d) ||
    (b.reservations_24h - a.reservations_24h) ||
    (new Date(b.last_seen) - new Date(a.last_seen));
  for (const key of Object.keys(tiered)) tiered[key].sort(byRelevance);

  // Detectar TIER-UPS vs el estado guardado en el run anterior
  const tierState = loadTierState();
  const tierUps = [];
  const currentTierByModel = new Map();
  for (const [tierName, entries] of Object.entries(tiered)) {
    for (const e of entries) currentTierByModel.set(e.model, { tier: tierName, entry: e });
  }
  for (const [model, { tier, entry }] of currentTierByModel) {
    const prev = tierState.models[model];
    const prevRank = prev ? (TIER_RANK[prev.tier] || 0) : 0;
    const nowRank = TIER_RANK[tier] || 0;
    // Solo notificar tier-ups a tier "útil" (≥ recurring).
    // Un modelo nuevo que entra como 💡 possible NO es un evento notable:
    // es el 95% del tráfico. Notificar solo cuando realmente empieza a
    // mostrar patrón: recurring, trending, hot, proven.
    if (nowRank > prevRank && nowRank >= TIER_RANK.recurring) {
      tierUps.push({
        model,
        from_tier: prev ? prev.tier : "none",
        to_tier: tier,
        from_label: prev ? (TIER_LABEL[prev.tier] || prev.tier) : "nuevo",
        to_label: TIER_LABEL[tier] || tier,
        entry,
      });
    }
    tierState.models[model] = { tier, updated_at: new Date(now).toISOString() };
  }
  // Purge state de modelos que ya no están en el history (ya ni en posible)
  const livingModels = new Set(currentTierByModel.keys());
  for (const key of Object.keys(tierState.models)) {
    if (!livingModels.has(key)) delete tierState.models[key];
  }
  saveTierState(tierState);

  return {
    updated_at: new Date(now).toISOString(),
    tiers: tiered,
    stats: {
      proven_seller: tiered.proven_seller.length,
      hot_24h:       tiered.hot_24h.length,
      trending_7d:   tiered.trending_7d.length,
      recurring:     tiered.recurring.length,
      possible:      tiered.possible.length,
      total_unique_models: groups.size,
      total_reservations: history.reservations.length,
      total_confirmed_sales: (sales.sales || []).length,
    },
    thresholds: {
      ...T,
      mode: (T === THRESHOLDS_INCUBATION) ? "incubation" : "mature",
    },
    tier_ups: tierUps,
  };
}

function saveOpportunities(opp) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OPPORTUNITIES_FILE, JSON.stringify(opp, null, 2), "utf8");
}

// Entry point usado por index.js al final del run.
//   reservedItems  → items con reserved=true detectados
//   allFetchedIds  → Set de TODOS los IDs fetched (para detectar desapariciones)
function updateFromRun(reservedItems, allFetchedIds = new Set()) {
  const { history, sales, newSales } = appendRun(reservedItems, allFetchedIds);
  const opp = computeOpportunities(history, sales);
  opp.new_sales = newSales;       // expuesto al caller para notificar
  saveOpportunities(opp);
  return opp;
}

module.exports = { updateFromRun, normalizeModel, computeOpportunities };
