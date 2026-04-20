// ============================================================
// Evaluator: orquesta perfil → filtros → estimación → score
// ============================================================

const vinilo = require("./profiles/vinilo");
const funko = require("./profiles/funko");
const funkoLote = require("./profiles/funko_lote");
const switchGame = require("./profiles/videojuego_switch");
const generic = require("./profiles/generic");
const { detectPriceContradiction } = require("./profiles/_base");

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

  // 0. Pre-check universal: contradicción de precio entre campo price y descripción
  //    (ej: "20€" en price field, "son 100€" en descripción)
  const contradiction = detectPriceContradiction(wpItem);
  if (contradiction) {
    return {
      pass: false,
      reason: `precio ambiguo: field=${contradiction.stated}€ pero desc menciona ${contradiction.mentioned}€`,
      profile: profile.name,
    };
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

  // 3. Obtener datos de mercado eBay (sold + active, con cache o fetch)
  let marketData = cache.getCached(searchQuery);
  let fromCache = true;
  if (!marketData || typeof marketData.sold_count === "undefined") {
    fromCache = false;
    const fetched = await ebay.fetchMarketData(searchQuery);
    marketData = fetched;
    cache.setCached(searchQuery, fetched);
  }

  // Normalizamos: el evaluator espera ebayData.prices (mantener compatibilidad con perfiles)
  const ebayData = { prices: marketData.sold || [] };

  if (!ebayData.prices || ebayData.prices.length < 3) {
    return { pass: false, reason: `eBay sin datos (${ebayData.prices?.length || 0})`, profile: profile.name, query: searchQuery };
  }

  // 3.1. Filtro de salud de mercado: ratio sold/active
  //   >1.5 → demanda alta, rápida rotación
  //   0.5-1.5 → equilibrio
  //   <0.5 → mercado saturado, tu item tarda en venderse
  const velocity = marketData.velocity_ratio;
  if (velocity !== null && velocity < 0.3 && marketData.active_count > 15) {
    return {
      pass: false,
      reason: `mercado saturado (${marketData.sold_count} sold vs ${marketData.active_count} active)`,
      profile: profile.name,
      query: searchQuery,
      sold_count: marketData.sold_count,
      active_count: marketData.active_count,
    };
  }

  // 4. Estimar precio de venta
  const ebayEst = profile.estimateEbayPrice(ebayData);
  if (!ebayEst.price) {
    return { pass: false, reason: "no se puede estimar precio eBay", profile: profile.name };
  }

  // 5. Score y margen
  const score = profile.scoreMargin(wpItem, ebayEst, config);

  // Safeguard universal: si el spread es extremo (>300% margen), es casi seguro que
  // la query eBay está comparando producto incorrecto (ej: funda vs consola).
  // Mejor falso negativo que falso positivo masivo.
  if (score.margin_pct > 300) {
    return {
      pass: false,
      reason: `spread extremo sospechoso (${score.margin_pct}%): probable query eBay mal calibrada`,
      profile: profile.name,
      query: searchQuery,
      ebay_price_estimate: ebayEst.price,
      ebay_count: ebayEst.count,
      margin_net: score.margin_net,
      margin_pct: score.margin_pct,
      score: score.score,
    };
  }

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
    sold_count: marketData.sold_count,
    active_count: marketData.active_count,
    velocity_ratio: marketData.velocity_ratio,
  };
}

module.exports = { evaluate, pickProfile };
