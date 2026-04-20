// ============================================================
// Utilidades base compartidas entre perfiles
// ============================================================

// Normaliza texto: lowercase, sin tildes, espacios colapsados
function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ¿Algún keyword aparece en el texto?
function anyKeyword(text, keywords) {
  const t = norm(text);
  return keywords.some(k => t.includes(norm(k)));
}

// Elimina palabras de relleno para construir query de búsqueda limpia
function cleanSearchTerms(title, stopwords = []) {
  const baseStops = ["vendo", "vende", "nuevo", "sellado", "mint", "perfecto", "estado",
    "impecable", "original", "autentico", "auténtico", "caja", "negociable", "reserva",
    "envio", "envío", "disponible", "lote", "conjunto", "coleccion", "colección",
    "unidad", "unidades", "und", "uds", "vinilo", "lp", "disco"];
  const stops = new Set([...baseStops, ...stopwords.map(norm)]);
  return norm(title)
    .split(/\s+/)
    .filter(w => w.length > 2 && !stops.has(w) && !/^[0-9]+$/.test(w))
    .slice(0, 5)
    .join(" ");
}

// Detecta señales de mal estado comunes
const BAD_CONDITION_SIGNALS = [
  "roto", "rota", "rotos", "rotas",
  "dañado", "dañada", "dañados", "dañadas",
  "mal estado", "no funciona",
  "defecto", "defectuoso", "defectuosa",
  "rayado", "rayada", "rayones",
  "quemado", "quemada",
  "amarillo", "amarillento", "amarilleado",
  "descolorido", "descolorida",
  "rasgado", "rasgada", "rasgon",
  "grieta", "grietas",
  "manchas", "manchado", "manchada",
];

function hasBadConditionSignal(text) {
  const t = norm(text);
  return BAD_CONDITION_SIGNALS.find(s => t.includes(s)) || null;
}

// Detecta señales de FAKE/COPIA
const FAKE_SIGNALS = [
  "aaa", "replica", "réplica", "copia",
  "no original", "first copy", "mirror quality",
  "tipo original", "imitacion", "imitación",
];

function hasFakeSignal(text) {
  const t = norm(text);
  return FAKE_SIGNALS.find(s => t.includes(s)) || null;
}

// Detecta si en la descripción hay un precio distinto al campo price.amount.
// Common trick: poner price=1€ o 20€ pero "son 100€ total" en descripción,
// para aparecer primero en búsquedas por precio.
function detectPriceContradiction(wpItem) {
  if (!wpItem.description) return null;
  const statedPrice = wpItem.price;
  const desc = wpItem.description;

  // Patrones de precio mencionado en texto
  // "son 100€", "precio real 100", "100€ total", "100 euros", "precio 100€"
  const patterns = [
    /son\s+(\d{2,4})\s*[€e]/gi,
    /precio\s+(?:real\s+|total\s+)?(\d{2,4})\s*[€e]/gi,
    /(\d{2,4})\s*[€e]\s+total/gi,
    /(\d{2,4})\s+euros?/gi,
    /\bvalen\s+(\d{2,4})\s*[€e]/gi,
    /por\s+(\d{2,4})\s*[€e]/gi,
  ];

  const mentioned = [];
  for (const re of patterns) {
    const matches = [...desc.matchAll(re)];
    for (const m of matches) {
      const p = parseInt(m[1], 10);
      if (p >= 10 && p < 10000) mentioned.push(p);
    }
  }

  if (!mentioned.length) return null;
  const maxMentioned = Math.max(...mentioned);

  // Si hay un precio mencionado >2x del campo price, es contradicción
  if (maxMentioned > statedPrice * 2) {
    return {
      stated: statedPrice,
      mentioned: maxMentioned,
      samples: mentioned,
    };
  }
  return null;
}

module.exports = {
  norm,
  anyKeyword,
  cleanSearchTerms,
  hasBadConditionSignal,
  hasFakeSignal,
  detectPriceContradiction,
};
