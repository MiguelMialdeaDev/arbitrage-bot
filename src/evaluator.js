// ============================================================
// Evaluator: orquesta perfil → filtros → estimación → score
// ============================================================

const vinilo = require("./profiles/vinilo");
const funko = require("./profiles/funko");
const funkoLote = require("./profiles/funko_lote");
const switchGame = require("./profiles/videojuego_switch");
const generic = require("./profiles/generic");
const { detectPriceContradiction } = require("./profiles/_base");
const wallapopSource = require("./sources/wallapop");

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

  // ============================================================
  // EBAY DESACTIVADO temporalmente (por decisión explícita de Miguel)
  // Vamos paso a paso: primero validar Wallapop-only para Funko,
  // luego re-habilitamos eBay como fuente complementaria.
  // Para re-activar: descomentar el bloque de abajo y quitar el stub.
  // ============================================================
  /*
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
  */

  // Stub mientras eBay está desactivado: datos vacíos para que el resto del
  // flujo no rompa. ebayEst.price=0 hará que la decisión dependa 100% del
  // cross-check Wallapop en perfiles que lo implementan (funko).
  const marketData = { sold: [], active: [], sold_count: 0, active_count: 0, velocity_ratio: null };
  const ebayData = { prices: [] };
  const ebayEst = { price: 0, count: 0, confidence: "none" };
  const fromCache = false;

  // 4.5. Cross-check Wallapop (SOLO funko por ahora, nicho por nicho)
  //   La idea: si se supone que esto es ganga, debería haber evidencia EN Wallapop
  //   (reservados del mismo producto → alguien lo está comprando AHORA).
  //   Si no hay reservados → o no se vende → o ya se habrá vendido → skip.
  let wallapopCheck = null;
  if (profile.name === "funko") {
    try {
      const wpSimilar = await wallapopSource.searchSimilarItems(searchQuery, { pages: 2 });
      const reservedMedian = wpSimilar.reserved_prices.length
        ? [...wpSimilar.reserved_prices].sort((a, b) => a - b)[Math.floor(wpSimilar.reserved_prices.length / 2)]
        : null;
      wallapopCheck = {
        query: searchQuery,
        active_count: wpSimilar.active_count,
        reserved_count: wpSimilar.reserved_count,
        reserved_median: reservedMedian,
        reserved_min: wpSimilar.reserved_prices.length ? Math.min(...wpSimilar.reserved_prices) : null,
      };

      // Regla: exigir al menos 2 reservados para confirmar demanda real en Wallapop
      if (wpSimilar.reserved_count < 2) {
        return {
          pass: false,
          reason: `sin demanda Wallapop (${wpSimilar.reserved_count} reservados de ${wpSimilar.total} items)`,
          profile: profile.name,
          query: searchQuery,
          ebay_price_estimate: ebayEst.price,
          ebay_count: ebayEst.count,
          wallapop_check: wallapopCheck,
        };
      }

      // Regla: el precio Wallapop debe estar al menos 20% por debajo del precio reservados
      // (sino, no es realmente ganga dentro del propio mercado Wallapop)
      if (reservedMedian && wpItem.price > reservedMedian * 0.8) {
        return {
          pass: false,
          reason: `precio Wallapop ${wpItem.price}€ no es ganga vs reservados ${reservedMedian}€ (umbral 80%)`,
          profile: profile.name,
          query: searchQuery,
          wallapop_check: wallapopCheck,
          ebay_price_estimate: ebayEst.price,
        };
      }
    } catch (e) {
      console.warn(`[evaluator] Wallapop cross-check falló: ${e.message}`);
      // No fallar por esto; seguir con eBay solo
    }
  }

  // 5. Score y margen
  //    Modo Wallapop-only para Funko: usar mediana de reservados como precio target.
  //    Para otros perfiles con eBay desactivado: skip (no pueden evaluar).
  let score;
  if (profile.name === "funko" && wallapopCheck?.reserved_median) {
    // Calcular margen Wallapop→Wallapop: compra a wpItem.price, revende al
    // precio mediano de los reservados. Envío nacional ~4.50€.
    const sellPrice = wallapopCheck.reserved_median;
    const buyPrice = wpItem.price;
    const margin_net = sellPrice - config.SHIPPING_ES_NATIONAL - config.PACKAGING - buyPrice;
    const margin_pct = buyPrice > 0 ? Math.round((margin_net / buyPrice) * 100) : 0;
    let s = 0;
    if (margin_pct >= 60) s += 40;
    else if (margin_pct >= 40) s += 30;
    else if (margin_pct >= 25) s += 20;
    else if (margin_pct >= 15) s += 10;
    if (margin_net >= 20) s += 30;
    else if (margin_net >= 12) s += 20;
    else if (margin_net >= 8) s += 15;
    // Bonus por más reservados (mayor confianza en precio target)
    if (wallapopCheck.reserved_count >= 5) s += 20;
    else if (wallapopCheck.reserved_count >= 3) s += 15;
    else if (wallapopCheck.reserved_count >= 2) s += 10;
    if (wpItem.shipping_ok) s += 5;
    if (wpItem.reserved) s -= 40;
    score = {
      score: Math.max(0, Math.min(100, s)),
      margin_net: Math.round(margin_net * 100) / 100,
      margin_pct,
      sell_price_target: sellPrice,
      ebay_count: 0,
    };
  } else {
    // Resto de perfiles: scoreMargin con ebayEst (que ahora es stub vacío).
    // Con eBay desactivado, cualquier perfil no-funko devolverá score=0 y skipea.
    score = profile.scoreMargin(wpItem, ebayEst, config);
  }

  // Safeguard universal: si el spread es extremo (>300% margen), es casi seguro
  // que la query está comparando producto incorrecto.
  if (score.margin_pct > 300) {
    return {
      pass: false,
      reason: `spread extremo sospechoso (${score.margin_pct}%): probable query mal calibrada`,
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
    wallapop_check: wallapopCheck,
  };
}

module.exports = { evaluate, pickProfile };
