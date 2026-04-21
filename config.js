// ============================================================
// Configuración del bot de arbitraje
// ============================================================

module.exports = {
  // Keywords a monitorizar en Wallapop
  // Cada keyword se mapea a un perfil según src/evaluator.js
  KEYWORDS: [
    // Territorio Miguel (nicho Funko + protectores)
    "protector funko pop",
    "funko pop exclusive",
    "funko pop chase",
    "funko lote",
    // Nintendo Switch (su domino)
    "nintendo switch",
    "juegos nintendo switch",
    "zelda switch",
    "mario switch",
    // Vinilos (donde vimos más arbitraje validado)
    "vinilo lp",
  ],

  // Umbrales de señal
  MIN_NET_MARGIN_EUR: 8,     // mínimo 8€ beneficio neto tras comisiones+envío
  MIN_MARGIN_PCT: 20,        // mínimo 20% de margen sobre precio compra
  MIN_SCORE: 65,             // score compuesto 0-100 del perfil

  // Costes para cálculo de margen
  EBAY_COMMISSION_RATE: 0.13,
  EBAY_PAYMENT_RATE: 0.029,
  SHIPPING_ES_NATIONAL: 4.5,
  PACKAGING: 1.0,

  // Cache
  EBAY_PRICE_CACHE_TTL_HOURS: 24,

  // Dedup de items ya procesados
  // true  = reprocesa TODO cada run (útil mientras afinamos filtros)
  // false = dedup normal, solo procesa items nuevos respecto a seen_items.json
  IGNORE_SEEN_ITEMS: false,

  // Wallapop search
  WALLAPOP_LAT: 40.4168,   // Madrid
  WALLAPOP_LNG: -3.7038,
  WALLAPOP_PAGES: 2,        // 2 páginas = 80 items por keyword

  // Rate limiting (ms entre requests)
  WALLAPOP_DELAY: 800,
  EBAY_DELAY: 1500,

  // Seguridad: descartar sellers sospechosos
  MIN_SELLER_RATING: 4.0,
  REJECT_IF_NEW_SELLER_AND_PRICE_TOO_LOW: true,   // cuenta nueva + precio chollo = posible scam

  // Debug
  DRY_RUN: process.env.DRY_RUN === "1",           // no envía Telegram, solo log
  VERBOSE: process.env.VERBOSE === "1",
};
