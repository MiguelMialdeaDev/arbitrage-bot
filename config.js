// ============================================================
// Configuración del bot de arbitraje
// ============================================================

module.exports = {
  // Categorías Wallapop a escanear (sin filtro de keywords).
  // Cubrimos universos enteros para dejar que los datos nos digan
  // qué se vende, en lugar de decidirlo nosotros a priori.
  //
  // IDs reales del endpoint /api/v3/categories?locale=es_ES
  CATEGORIES: [
    { id: 18000, name: "Coleccionismo",           pages: 3 },  // Funkos, figuras, cromos, cartas
    { id: 24200, name: "Tecnología y electrónica", pages: 3 }, // Consolas, gadgets, auriculares
    { id: 12463, name: "Cine, libros y música",    pages: 3 }, // Vinilos, CDs, libros, videojuegos
    { id: 12579, name: "Deporte y ocio",           pages: 2 }, // Juegos mesa, hobbies, coleccionables
    { id: 12461, name: "Niños y bebés",            pages: 2 }, // Juguetes, figuras, Lego
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
  WALLAPOP_PAGES: 3,        // default si CATEGORIES no especifica

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
