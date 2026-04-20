// ============================================================
// Evaluator: orquesta perfil → filtros → estimación → score
// ============================================================

const vinilo = require("./profiles/vinilo");
const funko = require("./profiles/funko");
const funkoLote = require("./profiles/funko_lote");
const switchGame = require("./profiles/videojuego_switch");
const generic = require("./profiles/generic");

// Ordenar por especificidad: los más específicos primero, genérico al final.
const PROFILES = [funkoLote, funko, switchGame, vinilo, generic];

function pickProfile(wpItem) {
  return PROFILES.find(p => p.matches(wpItem)) || null;
}

async function evaluate(wpItem, ebay, cache, config, logger = console) {
  const profile = pickProfile(wpItem);
  if (!profile) {
    return { pass: false, reason: "sin perfil aplicable" };
  }

  // 1. Filtros del perfil (estado, señales de fake, etc)
  const viability = profile.isViable(wpItem);
  if (!viability.ok) {
    return { pass: false, reason: viability.reason, profile: profile.name };
  }

  // 2. Extraer query para eBay
  const searchQuery = profile.extractSearchQuery(wpItem);
  if (!searchQuery || searchQuery.length < 4) {
    return { pass: false, reason: "título sin términos útiles", profile: profile.name };
  }

  // 3. Obtener precios eBay (cache o fetch)
  let ebayData = cache.getCached(searchQuery);
  let fromCache = true;
  if (!ebayData) {
    fromCache = false;
    const fetched = await ebay.fetchSoldPrices(searchQuery);
    ebayData = fetched;
    cache.setCached(searchQuery, fetched);
  }

  if (!ebayData.prices || ebayData.prices.length < 3) {
    return { pass: false, reason: `eBay sin datos (${ebayData.prices?.length || 0})`, profile: profile.name, query: searchQuery };
  }

  // 4. Estimar precio de venta
  const ebayEst = profile.estimateEbayPrice(ebayData);
  if (!ebayEst.price) {
    return { pass: false, reason: "no se puede estimar precio eBay", profile: profile.name };
  }

  // 5. Score y margen
  const score = profile.scoreMargin(wpItem, ebayEst, config);

  const pass = score.margin_net >= config.MIN_NET_MARGIN_EUR &&
               score.margin_pct >= config.MIN_MARGIN_PCT &&
               score.score >= config.MIN_SCORE;

  return {
    pass,
    reason: pass ? null : `score bajo (net=${score.margin_net}€, pct=${score.margin_pct}%, score=${score.score})`,
    profile: profile.name,
    query: searchQuery,
    ebay_price_estimate: ebayEst.price,
    ebay_median: ebayEst.median,
    ebay_count: ebayEst.count,
    ebay_confidence: ebayEst.confidence,
    margin_net: score.margin_net,
    margin_pct: score.margin_pct,
    score: score.score,
    viability,
    from_cache: fromCache,
  };
}

module.exports = { evaluate, pickProfile };
