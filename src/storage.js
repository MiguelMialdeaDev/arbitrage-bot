// ============================================================
// Persistencia de estado: seen items, cache de precios, stats
// ============================================================

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SEEN_FILE = path.join(ROOT, "seen_items.json");
const CACHE_FILE = path.join(ROOT, "price_cache.json");
const STATS_FILE = path.join(ROOT, "stats.json");
const SIGNALS_LOG = path.join(ROOT, "signals.log");

function loadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.warn(`[storage] Error cargando ${file}:`, e.message);
    return fallback;
  }
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.warn(`[storage] Error guardando ${file}:`, e.message);
  }
}

function loadSeen() {
  const raw = loadJson(SEEN_FILE, { items: {} });
  // Limpieza: descartar items vistos hace >30 días (para no crecer indefinidamente)
  const now = Date.now();
  const cutoff = 30 * 86400000;
  const cleaned = {};
  for (const [id, ts] of Object.entries(raw.items || {})) {
    if (now - ts < cutoff) cleaned[id] = ts;
  }
  return { items: cleaned };
}

function saveSeen(seen) { saveJson(SEEN_FILE, seen); }

function markSeen(seen, itemId) {
  seen.items[itemId] = Date.now();
}

function isSeen(seen, itemId) {
  return !!seen.items[itemId];
}

function loadCache() {
  return loadJson(CACHE_FILE, { prices: {} });
}

function saveCache(cache) { saveJson(CACHE_FILE, cache); }

function getCachedPrice(cache, query, ttlHours) {
  const entry = cache.prices[query];
  if (!entry) return null;
  const ageH = (Date.now() - entry.ts) / 3600000;
  if (ageH > ttlHours) return null;
  return entry;
}

function setCachedPrice(cache, query, data) {
  cache.prices[query] = { ...data, ts: Date.now() };
}

function loadStats() {
  return loadJson(STATS_FILE, {
    runs: 0,
    total_wp_items_fetched: 0,
    total_ebay_queries: 0,
    total_signals_sent: 0,
    last_run: null,
    by_keyword: {},
  });
}

function saveStats(stats) { saveJson(STATS_FILE, stats); }

function appendSignalLog(line) {
  try {
    fs.appendFileSync(SIGNALS_LOG, line + "\n", "utf8");
  } catch (e) {
    console.warn("[storage] Error append signals.log:", e.message);
  }
}

module.exports = {
  loadSeen, saveSeen, markSeen, isSeen,
  loadCache, saveCache, getCachedPrice, setCachedPrice,
  loadStats, saveStats,
  appendSignalLog,
};
