// ============================================================
// Configuración del bot de arbitraje
// ============================================================

module.exports = {
  // Categorías Wallapop a escanear. Cada categoría es un GRUPO de keywords
  // que cubren ese universo semántico. (La API pública de Wallapop ignora
  // category_ids sin keyword, así que filtramos con múltiples keywords por
  // categoría.) Esto amplía muchísimo la cobertura vs el modo anterior de
  // 9 keywords sueltas, y mantiene filtrado efectivo.
  CATEGORIES: [
    {
      id: 18000,
      name: "Coleccionismo",
      queries: ["funko pop", "lego", "cromos panini", "trading cards", "cartas magic", "cartas pokemon", "playmobil"],
      pages: 2,
    },
    {
      id: 24200,
      name: "Tecnología y electrónica",
      queries: ["nintendo switch", "playstation 5", "ps4 consola", "xbox series", "airpods", "iphone", "apple watch"],
      pages: 2,
    },
    {
      id: 12463,
      name: "Cine, libros y música",
      queries: ["vinilo lp", "cd coleccion", "blu ray", "manga lote", "comic marvel", "libro primera edicion"],
      pages: 2,
    },
    {
      id: 12579,
      name: "Deporte y ocio",
      queries: ["juego mesa", "monopoly", "puzzle 1000 piezas", "bicicleta montaña", "raqueta padel"],
      pages: 2,
    },
    {
      id: 12461,
      name: "Niños y bebés",
      queries: ["lego star wars", "juguete vintage", "figura anime", "muñeca coleccion", "accion figura"],
      pages: 2,
    },
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
