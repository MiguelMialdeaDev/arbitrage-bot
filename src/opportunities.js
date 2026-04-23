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

// Registra los reservados vistos en este run. Retención: 30 días.
function appendRun(reservedItems) {
  const history = loadHistory();
  const now = Date.now();
  const existing = new Set(history.reservations.map(r => r.id));
  for (const it of reservedItems) {
    if (existing.has(it.id)) continue;  // ya registrado en run previo, no duplicar
    history.reservations.push({
      id: it.id,
      title: it.title,
      model: normalizeModel(it.title),
      price: it.price,
      city: it.city,
      url: it.url,
      category: it.category || null,
      first_seen: new Date(now).toISOString(),
    });
  }
  // Purge antiguos (>30 días)
  const cutoff = now - RETENTION_30D;
  history.reservations = history.reservations.filter(r => new Date(r.first_seen).getTime() >= cutoff);
  saveHistory(history);
  return history;
}

// Agrupa por modelo normalizado y genera los tiers.
function computeOpportunities(history) {
  const now = Date.now();
  const T = pickThresholds(history);
  const groups = new Map();
  for (const r of history.reservations) {
    const key = r.model;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { model: key, items: [] });
    groups.get(key).items.push(r);
  }

  const tiered = {
    proven_seller: [],
    hot_24h: [],
    trending_7d: [],
    recurring: [],
    possible: [],
  };

  for (const [key, group] of groups) {
    const items = group.items.sort((a,b) => new Date(a.first_seen) - new Date(b.first_seen));
    const last24h = items.filter(i => now - new Date(i.first_seen).getTime() <= HORIZON_24H);
    const last7d  = items.filter(i => now - new Date(i.first_seen).getTime() <= HORIZON_7D);
    const last30d = items.filter(i => now - new Date(i.first_seen).getTime() <= HORIZON_30D);
    const prices = items.map(i => i.price).filter(p => p > 0).sort((a,b)=>a-b);
    const median = prices.length ? prices[Math.floor(prices.length/2)] : null;
    const min = prices[0] || null;
    const max = prices[prices.length-1] || null;

    // Frecuencia: reservas por día dentro de la ventana en que existe el modelo
    const spanMs = Math.max(1, new Date(items[items.length-1].first_seen) - new Date(items[0].first_seen));
    const spanDays = spanMs / (24 * 60 * 60 * 1000);
    const perDay = spanDays > 0 ? (items.length / Math.max(spanDays, 1)) : items.length;

    const entry = {
      model: key,
      example_title: items[items.length-1].title,
      example_url: items[items.length-1].url,
      total_reservations: items.length,
      reservations_24h: last24h.length,
      reservations_7d: last7d.length,
      reservations_30d: last30d.length,
      reservations_per_day: Math.round(perDay * 100) / 100,
      min_price: min,
      median_price: median,
      max_price: max,
      first_seen: items[0].first_seen,
      last_seen: items[items.length-1].first_seen,
      sample: items.slice(-3).map(i => ({ price: i.price, title: i.title, url: i.url, city: i.city })),
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
    },
    thresholds: {
      ...T,
      mode: (T === THRESHOLDS_INCUBATION) ? "incubation" : "mature",
    },
  };
}

function saveOpportunities(opp) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OPPORTUNITIES_FILE, JSON.stringify(opp, null, 2), "utf8");
}

// Entry point usado por index.js al final del run.
function updateFromRun(reservedItems) {
  const history = appendRun(reservedItems);
  const opp = computeOpportunities(history);
  saveOpportunities(opp);
  return opp;
}

module.exports = { updateFromRun, normalizeModel, computeOpportunities };
