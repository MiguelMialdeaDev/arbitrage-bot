// ============================================================
// Perfil: Funko LOTE (múltiples unidades)
// ============================================================
// Un lote Funko tiene valor de break-and-flip: compras N figuras
// por precio bajo, las separas y revendes individualmente.
//
// Estimación: valor_lote = N × precio_medio_unidad × 0.5 (conservador)
// Margen = valor_lote − precio_compra − costes envío por unidad
// ============================================================

const { norm, anyKeyword, hasBadConditionSignal } = require("./_base");

function matches(wpItem) {
  const t = norm(wpItem.title);
  // Heurísticas estrictas para lote REAL (evitar falsos positivos tipo "Or16 Funko")
  const isLote =
    // Título empieza con "Lote ..." o "Pack ..."
    /^(lote|pack|colecci(o|ó)n)\s/.test(t) ||
    // "lote de X" o "pack de X funkos"
    /\b(lote|pack)\s+(de|con)?\s*\d*\s*funkos?\b/.test(t) ||
    // Número al PRINCIPIO de título seguido de funkos (ej: "12 Funkos de Stranger Things")
    /^\d{1,3}\s+funkos?\b/.test(t) ||
    // "colección completa" / "set completo" / "todos los funkos"
    /\b(colecci(o|ó)n\s+completa|set\s+completo|todos\s+los\s+funkos)\b/.test(t) ||
    // Patrones plurales claros: "X + Y funkos" o "X funkos y Z funkos"
    /funkos\b.*\b(y|,|\+)\b.*funkos?\b/.test(t);
  return isLote && /funko|pop/.test(t);
}

function extractCount(text) {
  const t = norm(text);
  // "lote de 7 funkos", "pack 5 funkos", "15 figuras funko", etc
  let m = t.match(/(\d{1,2})\s*(funkos?|figuras|unidades|pops?)\b/);
  if (m) return parseInt(m[1], 10);
  m = t.match(/(?:lote|pack)\s+(\d{1,2})/);
  if (m) return parseInt(m[1], 10);
  // Para casos ambiguos: contar conjunciones ("y", "+", ",") entre nombres de personajes
  // Si hay al menos 2 conjunciones, probable lote de 3+
  const conjunctions = (t.match(/\s+(y|,|\+|&)\s+/g) || []).length;
  if (conjunctions >= 2) return Math.min(5, conjunctions + 1);
  if (conjunctions === 1) return 2;
  // Default conservador: no podemos determinar → no tratar como lote grande
  return 0;
}

function isViable(wpItem) {
  const text = `${wpItem.title} ${wpItem.description}`;
  const textN = norm(text);

  const generalBad = hasBadConditionSignal(text);
  if (generalBad) return { ok: false, reason: `estado: ${generalBad}` };

  // Mini funkos / kinder = no son Funkos Pop estándar, valen muy poco
  if (/kinder|mini\s+funko|mini-?funko|pocket\s+pop/.test(textN)) {
    return { ok: false, reason: "mini funkos / kinder, sin valor de reventa" };
  }
  if (/llavero|keychain/.test(textN)) {
    return { ok: false, reason: "llaveros, no lote real" };
  }

  const count = extractCount(text);
  if (count < 3) return { ok: false, reason: `count=${count} < 3, no es lote claro` };

  return { ok: true, confidence: count >= 5 ? "high" : "medium", figures_count: count };
}

function extractSearchQuery(wpItem) {
  // Para lotes, usamos keyword genérico pero específico al estilo
  // Ej: "Funko Pop Stranger Things" si el lote es de Stranger Things
  const text = norm(wpItem.title);
  const franchises = [
    "stranger things", "harry potter", "marvel", "star wars", "dragon ball",
    "one piece", "naruto", "my hero academia", "dc", "disney", "pixar",
    "demon slayer", "attack on titan", "overwatch", "friends", "game of thrones"
  ];
  const franchise = franchises.find(f => text.includes(f));
  return franchise ? `Funko Pop ${franchise}` : "Funko Pop";
}

function estimateEbayPrice(ebayData) {
  if (!ebayData.prices || ebayData.prices.length < 3) {
    return { price: 0, confidence: "none" };
  }
  const sorted = [...ebayData.prices].filter(p => p >= 5 && p <= 60).sort((a, b) => a - b);
  if (sorted.length < 3) return { price: 0, confidence: "none" };
  const median = sorted[Math.floor(sorted.length / 2)];
  return {
    price: median,
    median,
    p25: sorted[Math.floor(sorted.length * 0.25)],
    count: sorted.length,
    confidence: sorted.length >= 10 ? "medium" : "low",
  };
}

function scoreMargin(wpItem, ebayEst, config) {
  const sellUnitPrice = ebayEst.price;
  const buyPrice = wpItem.price;
  if (!sellUnitPrice || !buyPrice) return { score: 0, margin_net: 0, margin_pct: 0 };

  // Asumimos: se revende cada unidad a 50% del precio mediano (conservador por estado desconocido)
  const viab = isViable(wpItem);
  const count = viab.figures_count || 4;
  const sellTotal = count * sellUnitPrice * 0.5;

  // Costes agregados: comisión + pago sobre cada venta + envío × count
  const commission = sellTotal * config.EBAY_COMMISSION_RATE;
  const payment = sellTotal * config.EBAY_PAYMENT_RATE;
  const shippingAgg = count * config.SHIPPING_ES_NATIONAL;
  const packagingAgg = count * config.PACKAGING;
  const margin_net = sellTotal - commission - payment - shippingAgg - packagingAgg - buyPrice;
  const margin_pct = buyPrice > 0 ? (margin_net / buyPrice) * 100 : 0;

  let score = 0;
  if (margin_pct >= 80) score += 40;
  else if (margin_pct >= 50) score += 30;
  else if (margin_pct >= 30) score += 20;
  else if (margin_pct >= 15) score += 10;

  if (margin_net >= 30) score += 30;
  else if (margin_net >= 20) score += 25;
  else if (margin_net >= 12) score += 15;
  else if (margin_net >= 8) score += 10;

  if (ebayEst.confidence === "high") score += 20;
  else if (ebayEst.confidence === "medium") score += 15;
  else if (ebayEst.confidence === "low") score += 5;

  if (wpItem.shipping_ok) score += 5;
  if (wpItem.reserved) score -= 40;

  return {
    score: Math.max(0, Math.min(100, score)),
    margin_net: Math.round(margin_net * 100) / 100,
    margin_pct: Math.round(margin_pct),
    sell_price_target: Math.round(sellTotal * 100) / 100,
    figures_count: count,
    ebay_count: ebayEst.count,
  };
}

module.exports = {
  name: "funko_lote",
  matches,
  isViable,
  extractSearchQuery,
  estimateEbayPrice,
  scoreMargin,
};
