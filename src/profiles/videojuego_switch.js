// ============================================================
// Perfil: Videojuego Nintendo Switch
// ============================================================
// Ganga = juego Switch en buen estado con caja (CIB preferido)
// donde el precio Wallapop está por debajo del precio eBay.de
// del mismo juego.
//
// El extractor preserva "Nintendo Switch" en la query para que
// eBay no devuelva resultados de PC/PS4 del mismo juego.
// ============================================================

const { norm, anyKeyword, hasBadConditionSignal } = require("./_base");

const SWITCH_KEYWORDS = ["nintendo switch", "switch oled", "switch lite"];

const JUEGO_SIGNALS = [
  // Pistas de que es un juego y no la consola
  "mario", "zelda", "pokemon", "pokémon", "kirby", "metroid", "xenoblade",
  "splatoon", "fire emblem", "bayonetta", "animal crossing", "paper mario",
  "luigi", "donkey kong", "yoshi", "super smash", "smash bros",
  "kart", "odyssey", "breath of the wild", "tears of the kingdom",
  "witcher", "minecraft", "fortnite", "fifa", "madden",
  "lego", "sonic", "crash", "just dance", "ring fit",
];

const BAD_SWITCH_SIGNALS = [
  // Item incompleto / solo parcial
  "solo caja", "solo carátula", "solo caratula", "sin juego", "caja vacia", "caja vacía",
  "caratula sin", "no incluye juego", "sin el juego", "only case", "only box",
  "solo manual", "sin cartucho", "sin carátula",
  // Estado malo
  "no funciona", "pantalla rota", "mojado", "quemado",
  "sin cable", "sin cargador", "joy con rotos", "joycon rotos",
  // Digital / reserva
  "juego eliminado", "solo codigo", "solo código", "codigo descargado",
  "reserva", "pre-order", "preventa",
];

function matches(wpItem) {
  const text = norm(`${wpItem.title} ${wpItem.description}`);
  // Matchear si menciona Switch
  const mentionsSwitch = anyKeyword(text, SWITCH_KEYWORDS);
  if (!mentionsSwitch) return false;
  // Si además menciona un juego famoso, es claro candidate
  // Aunque también podría ser consola vacía
  return true;
}

function detectType(textN) {
  // Pack explícito (múltiples juegos)
  if (/\bpack\s+(de\s+)?\d+\s+juegos?\b|\blote\s+\d+\s+juegos?\b|\d+\s+juegos?\s+switch/i.test(textN) ||
      /juegos?\s+switch.*\s+y\s+.*juegos?/i.test(textN)) {
    return "pack_juegos";
  }
  // Pack consola + juegos
  if (/switch.*\+\s*juegos?\b|switch.*\+\s*mario|switch.*\+\s*zelda|pack\s+switch/.test(textN)) {
    return "pack_consola_juegos";
  }
  // Distinguir entre consola y juego
  if (/\b(consola|only|solo|completa|sola)\b.*switch\b/.test(textN) && !JUEGO_SIGNALS.some(j => textN.includes(j))) {
    return "consola";
  }
  const hasJuego = JUEGO_SIGNALS.some(j => textN.includes(j));
  if (hasJuego) return "juego";
  return "unknown";
}

function isViable(wpItem) {
  const text = `${wpItem.title} ${wpItem.description}`;
  const textN = norm(text);

  // 1. Señales específicas de mal estado / item incompleto
  const badSignal = BAD_SWITCH_SIGNALS.find(s => textN.includes(s));
  if (badSignal) return { ok: false, reason: `switch problema: ${badSignal}` };

  // 2. Mal estado general
  const generalBad = hasBadConditionSignal(text);
  if (generalBad) return { ok: false, reason: `estado: ${generalBad}` };

  // 3. "Manual" solo, "Steelbook" solo (sin juego)
  if (/\bmanual\s+(de|del|legend|zelda|mario)|\bsteelbook\s+sin\s+juego\b/.test(textN)) {
    return { ok: false, reason: "solo manual/steelbook, sin juego" };
  }

  // 4. Códigos digitales (no físico)
  if (/\b(codigo|código)\s+digital\b|\bdownload\s+code\b|descargable/.test(textN)) {
    return { ok: false, reason: "código digital, no físico" };
  }

  // 5. Clasificar
  const type = detectType(textN);

  // 6. Packs son de alto riesgo de mala comparación eBay → skip conservador
  //    (usuario Miguel: "hay muchos packs enteros por el mismo precio, dudo que elijan
  //    una switch sin nada", "pack de gunvolt tienen además un juego más")
  if (type === "pack_juegos" || type === "pack_consola_juegos") {
    return { ok: false, reason: `pack (${type}): comparación eBay imprecisa, skip conservador` };
  }

  // 7. Rango de precio razonable según tipo
  if (type === "consola") {
    if (wpItem.price < 80) return { ok: false, reason: "consola <80€ sospechoso" };
    if (wpItem.price > 450) return { ok: false, reason: "consola >450€ sin margen" };
  } else if (type === "juego") {
    if (wpItem.price < 8) return { ok: false, reason: "juego <8€, margen imposible tras envío" };
    if (wpItem.price > 80) return { ok: false, reason: "juego >80€ difícil arbitrar" };
  } else {
    // unknown: más conservador
    if (wpItem.price < 15 || wpItem.price > 400) {
      return { ok: false, reason: "precio fuera de rango razonable" };
    }
  }

  // 7. Prefer señales de CIB (Complete In Box)
  const isCib = /\bcib\b|\bcaja\b|\bcompleto\b|\bmanual\b|\b(con|incluye)\s+caja/.test(textN);
  const isBoxless = /\bloose\b|\bsin\s+caja\b|\bsolo\s+cartucho\b/.test(textN);

  return {
    ok: true,
    confidence: isCib ? "high" : isBoxless ? "low" : "medium",
    type,
    is_cib: isCib,
    is_boxless: isBoxless,
  };
}

function extractSearchQuery(wpItem) {
  // Clave: preservar "Nintendo Switch" o "Switch" en la query para que
  // eBay no mezcle versiones de PC/PS4/Xbox del mismo juego.
  const t = norm(wpItem.title);

  // Extraer palabras relevantes (no stopwords)
  const stops = new Set([
    "nueva", "nuevo", "nuevos", "precintado", "sellado", "perfecto", "estado",
    "original", "autentico", "auténtico", "completo", "caja", "cib", "manual",
    "videojuego", "videojuegos", "juegos", "juego", "consola", "para", "con",
    "sin", "solo", "versión", "version", "edicion", "edición",
  ]);
  const words = t.split(/\s+/).filter(w => w.length > 2 && !stops.has(w) && !/^[0-9]+$/.test(w));

  // Si ya contiene "nintendo" o "switch" usamos las primeras 4-5 palabras
  // Si no, añadimos "Nintendo Switch" al final
  const mentionsSwitch = words.some(w => /switch|nintendo/.test(w));
  const essential = words.slice(0, 5).join(" ");
  return mentionsSwitch ? essential : `${essential} Nintendo Switch`.trim();
}

function estimateEbayPrice(ebayData) {
  if (!ebayData.prices || ebayData.prices.length < 4) {
    return { price: 0, confidence: "none" };
  }
  const { estimateCompetitivePrice } = require("../pricing/ebay");
  // Precio competitivo = el más bajo que se repite ≥3 veces (±15%)
  // Representa lo que TÚ tendrías que cobrar para vender rápido
  const competitive = estimateCompetitivePrice(ebayData.prices, 3, 0.15);
  if (!competitive) return { price: 0, confidence: "none", reason: "ningún precio se repite ≥3 veces" };

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
  if (margin_pct >= 50) score += 40;
  else if (margin_pct >= 30) score += 25;
  else if (margin_pct >= 20) score += 15;

  if (margin_net >= 20) score += 30;
  else if (margin_net >= 12) score += 20;
  else if (margin_net >= 8) score += 10;

  if (ebayEst.confidence === "high") score += 20;
  else if (ebayEst.confidence === "medium") score += 10;
  else if (ebayEst.confidence === "low") score += 5;

  // Bonus CIB (Complete In Box)
  const viab = isViable(wpItem);
  if (viab.is_cib) score += 10;
  if (viab.is_boxless) score -= 10;

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
  name: "videojuego_switch",
  matches,
  isViable,
  extractSearchQuery,
  estimateEbayPrice,
  scoreMargin,
};
