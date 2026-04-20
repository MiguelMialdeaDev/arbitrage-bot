// ============================================================
// Perfil: GENERIC (fallback universal)
// ============================================================
// Se activa cuando ningún perfil específico matchea la keyword.
// Aplica filtros comunes (fake, mal estado) y usa el título
// limpio como query eBay. Menos preciso que perfiles específicos
// pero útil para explorar nichos nuevos rápidamente.
// ============================================================

const { norm, cleanSearchTerms, hasBadConditionSignal, hasFakeSignal } = require("./_base");

// Este perfil se activa SIEMPRE (último en el pipeline, fallback).
function matches(wpItem) {
  return true;
}

function isViable(wpItem) {
  const text = `${wpItem.title} ${wpItem.description}`;

  const bad = hasBadConditionSignal(text);
  if (bad) return { ok: false, reason: `mal estado: ${bad}` };

  const fake = hasFakeSignal(text);
  if (fake) return { ok: false, reason: `posible fake: ${fake}` };

  // Skip items muy pequeños/baratos donde el envío mata margen
  if (wpItem.price < 10) {
    return { ok: false, reason: "ticket bajo (<10€), envío mata margen" };
  }

  return { ok: true, confidence: "low" };  // confidence baja por defecto
}

function extractSearchQuery(wpItem) {
  // Estrategia: primeras 4-5 palabras útiles del título
  return cleanSearchTerms(wpItem.title);
}

function estimateEbayPrice(ebayData) {
  if (!ebayData.prices || ebayData.prices.length < 5) {
    return { price: 0, confidence: "none" };
  }
  const sorted = [...ebayData.prices].sort((a, b) => a - b);
  // Filtrar outliers agresivamente (productos no relacionados suelen ser <25% del mediano)
  const median = sorted[Math.floor(sorted.length / 2)];
  const filtered = sorted.filter(p => p >= median * 0.3 && p <= median * 3);
  if (filtered.length < 5) return { price: 0, confidence: "none" };

  const filteredMedian = filtered[Math.floor(filtered.length / 2)];
  const p25 = filtered[Math.floor(filtered.length * 0.25)];
  // Muy conservador porque la query es genérica, precio eBay puede ser sobre items distintos
  const conservativePrice = Math.round(p25 * 100) / 100;
  return {
    price: conservativePrice,
    median: filteredMedian,
    p25,
    count: filtered.length,
    confidence: filtered.length >= 20 ? "medium" : "low",
  };
}

function scoreMargin(wpItem, ebayEst, config) {
  const sellPrice = ebayEst.price;
  const buyPrice = wpItem.price;
  if (!sellPrice || !buyPrice) return { score: 0, margin_net: 0, margin_pct: 0 };

  const commission = sellPrice * config.EBAY_COMMISSION_RATE;
  const payment = sellPrice * config.EBAY_PAYMENT_RATE;
  const margin_net = sellPrice - commission - payment - config.SHIPPING_ES_NATIONAL - config.PACKAGING - buyPrice;
  const margin_pct = buyPrice > 0 ? (margin_net / buyPrice) * 100 : 0;

  let score = 0;
  // Genérico: umbrales más altos porque confidence es baja
  if (margin_pct >= 80) score += 40;
  else if (margin_pct >= 50) score += 25;
  else if (margin_pct >= 30) score += 15;

  if (margin_net >= 20) score += 30;
  else if (margin_net >= 12) score += 20;
  else if (margin_net >= 8) score += 10;

  // El perfil genérico nunca da confidence alta; penalizar
  if (ebayEst.confidence === "medium") score += 15;
  else if (ebayEst.confidence === "low") score += 5;

  if (wpItem.shipping_ok) score += 5;
  if (wpItem.reserved) score -= 30;

  return {
    score: Math.max(0, Math.min(100, score)),
    margin_net: Math.round(margin_net * 100) / 100,
    margin_pct: Math.round(margin_pct),
    sell_price_target: sellPrice,
    ebay_count: ebayEst.count,
  };
}

module.exports = {
  name: "generic",
  matches,
  isViable,
  extractSearchQuery,
  estimateEbayPrice,
  scoreMargin,
};
