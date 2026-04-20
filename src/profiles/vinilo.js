// ============================================================
// Perfil: Vinilos LP
// ============================================================
// Ganga = vinilo con grading NM/VG+/Mint donde el precio Wallapop
// está 30%+ por debajo de la mediana eBay.es del MISMO disco.
// ============================================================

const { norm, anyKeyword, cleanSearchTerms, hasBadConditionSignal } = require("./_base");

const GOOD_GRADES = ["nm", "near mint", "mint", "como nuevo", "perfecto", "impecable", "vg+", "vg plus", "excelente", "excelent"];
const BAD_GRADES = ["vg-", "g+", " g ", "fair", "poor", "played"];

const BAD_VINYL_SIGNALS = [
  "rayado", "rayada", "rayones",
  "salta", "salto",
  "chasquido", "crujido",
  "ruido", "static",
  "no suena", "no lee",
  "solo portada", "solo disco", "solo funda",
  "sin portada", "sin funda",
  "deforma", "alabead", // alabeado (deformado)
];

const VINILO_KEYWORDS = ["vinilo", "lp", "33 rpm", "vinyl", "single"];

function matches(wpItem) {
  const text = `${wpItem.title} ${wpItem.description}`;
  return anyKeyword(text, VINILO_KEYWORDS);
}

function isViable(wpItem) {
  const text = `${wpItem.title} ${wpItem.description}`;
  const textN = norm(text);

  // 1. Señales específicas de mal estado del vinilo
  const badSignal = BAD_VINYL_SIGNALS.find(s => textN.includes(s));
  if (badSignal) return { ok: false, reason: `vinilo problema: ${badSignal}` };

  // 2. Grade explícitamente malo
  const badGrade = BAD_GRADES.find(g => textN.includes(g));
  if (badGrade) return { ok: false, reason: `grade malo: ${badGrade}` };

  // 3. Señal general de mal estado
  const generalBad = hasBadConditionSignal(text);
  if (generalBad) return { ok: false, reason: `estado: ${generalBad}` };

  // 4. Detectar si es compilación de Grandes Éxitos (saturadas, baratas siempre)
  if (/grandes exitos|greatest hits|best of/i.test(text) && wpItem.price < 8) {
    return { ok: false, reason: "compilación genérica, sin valor" };
  }

  // 5. Detectar recopilatorios multi-LP que confunden el precio
  if (/lote|coleccion|pack/.test(textN) && !/1\s*lp/.test(textN)) {
    return { ok: false, reason: "lote multi-disco, no evaluable" };
  }

  // 6. Prefer grados buenos explícitos (aumenta confianza)
  const hasGoodGrade = GOOD_GRADES.find(g => textN.includes(g));
  const confidence = hasGoodGrade ? "high" : "medium";

  return { ok: true, confidence, grade_hint: hasGoodGrade || null };
}

// Extrae "artista + álbum" para búsqueda específica en eBay
function extractSearchQuery(wpItem) {
  const stopwords = ["estado", "original", "edicion", "edición", "vinyl", "vinilo", "lp", "disco",
    "grabado", "1ª", "2ª", "3ª", "4ª", "5ª", "primera", "segunda", "tercera"];
  return cleanSearchTerms(wpItem.title, stopwords);
}

// Estima precio eBay.es: usa la mediana pero solo si hay al menos 5 sold listings
function estimateEbayPrice(ebayData) {
  if (!ebayData.prices || ebayData.prices.length < 3) {
    return { price: 0, confidence: "none", reason: "pocos sold listings" };
  }
  const { estimateCompetitivePrice } = require("../pricing/ebay");
  const filtered = ebayData.prices.filter(p => p >= 4 && p <= 500);
  if (filtered.length < 3) return { price: 0, confidence: "none" };
  const competitive = estimateCompetitivePrice(filtered, 3, 0.15);
  if (!competitive) return { price: 0, confidence: "none", reason: "precio mínimo no se repite" };
  return {
    price: competitive.price,
    cluster_size: competitive.cluster_size,
    cluster_range: [competitive.cluster_min, competitive.cluster_max],
    count: competitive.total_samples,
    confidence: competitive.cluster_size >= 8 ? "high" : competitive.cluster_size >= 5 ? "medium" : "low",
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

  // Score compuesto
  let score = 0;
  if (margin_pct >= 50) score += 40;
  else if (margin_pct >= 30) score += 30;
  else if (margin_pct >= 20) score += 20;
  else if (margin_pct >= 10) score += 10;

  if (margin_net >= 20) score += 30;
  else if (margin_net >= 15) score += 25;
  else if (margin_net >= 10) score += 20;
  else if (margin_net >= 8) score += 15;

  if (ebayEst.confidence === "high") score += 20;
  else if (ebayEst.confidence === "medium") score += 10;

  if (wpItem.is_top_profile) score -= 5;  // vendedor pro suele tasarse bien
  if (wpItem.shipping_ok) score += 5;
  if (wpItem.reserved) score -= 30;        // casi seguro venta ya

  return {
    score: Math.max(0, Math.min(100, score)),
    margin_net: Math.round(margin_net * 100) / 100,
    margin_pct: Math.round(margin_pct),
    sell_price_target: sellPrice,
    ebay_count: ebayEst.count,
  };
}

module.exports = {
  name: "vinilo",
  matches,
  isViable,
  extractSearchQuery,
  estimateEbayPrice,
  scoreMargin,
};
