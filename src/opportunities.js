// ============================================================
// Opportunities tracker: acumula items reservados a lo largo del
// tiempo, agrupa por modelo (título normalizado) y genera tiers
// de confianza de ganga para que el dashboard los pinte.
//
// Tiers:
//   🔥 super_ganga    → ≥3 reservados del mismo modelo en últimas 24h
//   ✨ high_confidence → ≥2 reservados del mismo modelo (24h o histórico)
//   💡 possible       → 1 reservado del modelo (señal débil)
// ============================================================

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const HISTORY_FILE = path.join(DATA_DIR, "reservations_history.json");
const OPPORTUNITIES_FILE = path.join(DATA_DIR, "opportunities.json");

const HORIZON_24H = 24 * 60 * 60 * 1000;
const HORIZON_7D = 7 * 24 * 60 * 60 * 1000;
const RETENTION_30D = 30 * 24 * 60 * 60 * 1000;

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
  const groups = new Map();
  for (const r of history.reservations) {
    const key = r.model;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { model: key, items: [] });
    groups.get(key).items.push(r);
  }

  const tiered = { super_ganga: [], high_confidence: [], possible: [] };

  for (const [key, group] of groups) {
    const items = group.items.sort((a,b) => new Date(a.first_seen) - new Date(b.first_seen));
    const last24h = items.filter(i => now - new Date(i.first_seen).getTime() <= HORIZON_24H);
    const last7d  = items.filter(i => now - new Date(i.first_seen).getTime() <= HORIZON_7D);
    const prices = items.map(i => i.price).filter(p => p > 0).sort((a,b)=>a-b);
    const median = prices.length ? prices[Math.floor(prices.length/2)] : null;
    const min = prices[0] || null;
    const max = prices[prices.length-1] || null;

    const entry = {
      model: key,
      example_title: items[items.length-1].title,     // el más reciente como ejemplo
      example_url: items[items.length-1].url,
      total_reservations: items.length,
      reservations_24h: last24h.length,
      reservations_7d: last7d.length,
      min_price: min,
      median_price: median,
      max_price: max,
      first_seen: items[0].first_seen,
      last_seen: items[items.length-1].first_seen,
      sample: items.slice(-3).map(i => ({ price: i.price, title: i.title, url: i.url, city: i.city })),
    };

    if (entry.reservations_24h >= 3) tiered.super_ganga.push(entry);
    else if (items.length >= 2)      tiered.high_confidence.push(entry);
    else                             tiered.possible.push(entry);
  }

  // Orden: más reservas primero, después más recientes
  const byRel = (a,b) => (b.reservations_24h - a.reservations_24h) ||
                        (b.total_reservations - a.total_reservations) ||
                        (new Date(b.last_seen) - new Date(a.last_seen));
  tiered.super_ganga.sort(byRel);
  tiered.high_confidence.sort(byRel);
  tiered.possible.sort(byRel);

  return {
    updated_at: new Date(now).toISOString(),
    tiers: tiered,
    stats: {
      super_ganga:     tiered.super_ganga.length,
      high_confidence: tiered.high_confidence.length,
      possible:        tiered.possible.length,
      total_unique_models: groups.size,
      total_reservations: history.reservations.length,
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
