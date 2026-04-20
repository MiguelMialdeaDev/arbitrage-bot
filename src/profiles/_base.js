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

module.exports = {
  norm,
  anyKeyword,
  cleanSearchTerms,
  hasBadConditionSignal,
  hasFakeSignal,
};
