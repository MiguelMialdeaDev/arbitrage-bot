// ============================================================
// Perfil: Funko Pop (exclusive / lote / sellado)
// ============================================================
// Ganga = Funko con caja en buen estado donde el precio está
// por debajo del precio eBay.es de esa figura concreta.
// ============================================================

const { norm, anyKeyword, cleanSearchTerms, hasBadConditionSignal } = require("./_base");

const FUNKO_KEYWORDS = ["funko", "pop vinyl", "pop! "];

const BAD_FUNKO_SIGNALS = [
  "sin caja", "loose", "solo figura",
  "caja rota", "caja dañada", "aplastada",
  "caja doblada", "caja fea", "caja amarilla",
  "amarillo", "amarillento", "amarilleado",
  "quemado sol", "descolorido",
  "pegatina", "precio tachado",
  "reproducción", "reproduccion",
];

const EXCLUSIVE_SIGNALS = ["exclusive", "sdcc", "nycc", "eccc", "fyi", "chase", "glow", "metallic", "flocked", "limited", "limitada", "edicion especial"];

function matches(wpItem) {
  const text = `${wpItem.title} ${wpItem.description}`;
  return anyKeyword(text, FUNKO_KEYWORDS);
}

function isViable(wpItem) {
  const text = `${wpItem.title} ${wpItem.description}`;
  const textN = norm(text);

  // 1. Señales específicas de mal estado
  const badSignal = BAD_FUNKO_SIGNALS.find(s => textN.includes(s));
  if (badSignal) return { ok: false, reason: `funko problema: ${badSignal}` };

  // 2. Mal estado general
  const generalBad = hasBadConditionSignal(text);
  if (generalBad) return { ok: false, reason: `estado: ${generalBad}` };

  // 3. Skip lotes REALES (usar mismos patrones estrictos que funko_lote.matches())
  const isRealLot =
    /^(lote|pack|colecci(o|ó)n)\s/.test(textN) ||
    /\b(lote|pack)\s+(de|con)?\s*\d*\s*funkos?\b/.test(textN) ||
    /^\d{1,3}\s+funkos?\b/.test(textN) ||
    /\b(colecci(o|ó)n\s+completa|set\s+completo|todos\s+los\s+funkos)\b/.test(textN);
  if (isRealLot) return { ok: false, reason: "es lote real, va al perfil funko_lote" };

  // 4. Skip keychains, kinder joy funkos y items pequeños (no son Pop estándar)
  if (/\bkinder\b|\bhuevo\s+sorpresa\b|\bllavero|keychain|funko\s+mini|mystery\s+mini|pocket\s+pop\b|\bmu[ñn]ecos?\s+funko/.test(textN)) {
    return { ok: false, reason: "no es Pop estándar (kinder/mini/llavero)" };
  }

  // 5. Detectar si es exclusive/chase (mayor valor)
  const isExclusive = EXCLUSIVE_SIGNALS.some(s => textN.includes(s));
  const confidence = isExclusive ? "high" : "medium";

  return { ok: true, confidence, is_exclusive: isExclusive };
}

function extractSearchQuery(wpItem) {
  // Para Funko, el NÚMERO (#509, #1339, etc) es lo que identifica unívocamente
  // al Funko concreto. Hay muchos "Goku" pero solo un "Goku 509".
  // Si perdemos el número, la query es ambigua y eBay devuelve 0 o ruido.
  const title = wpItem.title || "";

  // 1. Extraer número del Funko: puede aparecer como "#509", "nº 509", "num 509",
  //    "Funko 509" o simplemente "509" al lado del nombre.
  let funkoNumber = null;
  const numMatch = title.match(/#\s*(\d{1,5})\b|(?:\bn[ºoº°]|\bnum|\bnumero|\bno\.?)\s*(\d{1,5})\b|\b(\d{2,5})(?=\s|$|[^0-9])/);
  if (numMatch) {
    funkoNumber = numMatch[1] || numMatch[2] || numMatch[3];
  }

  // 2. Limpiar título normalmente (quita stopwords)
  const stopwords = ["funko", "pop", "vinyl", "figura", "coleccionable", "nuevo",
    "sellado", "caja", "original", "autentico", "auténtico", "protector"];
  const cleaned = cleanSearchTerms(title, stopwords);

  // 3. Construir query con el número si existe
  //    (cleanSearchTerms filtra números por `!/^[0-9]+$/.test(w)`, así que
  //     lo añadimos manualmente si lo teníamos)
  const base = `Funko ${cleaned}`.trim();
  if (funkoNumber && !base.includes(funkoNumber)) {
    return `${base} ${funkoNumber}`.trim();
  }
  return base;
}

function estimateEbayPrice(ebayData) {
  if (!ebayData.prices || ebayData.prices.length < 3) {
    return { price: 0, confidence: "none" };
  }
  const { estimateCompetitivePrice } = require("../pricing/ebay");
  // Filtrar rango Funkos (8-250€) antes de estimar
  const filtered = ebayData.prices.filter(p => p >= 8 && p <= 250);
  if (filtered.length < 3) return { price: 0, confidence: "none" };
  // Precio competitivo: el más bajo que se repite ≥3 veces (±15%)
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

  let score = 0;
  if (margin_pct >= 60) score += 40;
  else if (margin_pct >= 40) score += 30;
  else if (margin_pct >= 25) score += 20;
  else if (margin_pct >= 15) score += 10;

  if (margin_net >= 25) score += 30;
  else if (margin_net >= 15) score += 25;
  else if (margin_net >= 10) score += 20;
  else if (margin_net >= 8) score += 15;

  if (ebayEst.confidence === "high") score += 20;
  else if (ebayEst.confidence === "medium") score += 10;

  if (wpItem.shipping_ok) score += 5;
  if (wpItem.reserved) score -= 40;

  return {
    score: Math.max(0, Math.min(100, score)),
    margin_net: Math.round(margin_net * 100) / 100,
    margin_pct: Math.round(margin_pct),
    sell_price_target: sellPrice,
    ebay_count: ebayEst.count,
  };
}

module.exports = {
  name: "funko",
  matches,
  isViable,
  extractSearchQuery,
  estimateEbayPrice,
  scoreMargin,
};
