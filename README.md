# Arbitrage Bot · Wallapop ES → eBay.es

Detecta gangas en Wallapop ES que se pueden revender en eBay.es con margen real.
Envía señales por Telegram con item, precio, margen estimado y enlace directo.

## Qué hace

1. Cada 45 min escanea Wallapop buscando keywords configuradas
2. Para cada item nuevo:
   - Aplica el **perfil del nicho** (filtros de estado específicos: "sin caja", "roto", "rayado", etc)
   - Busca el **precio específico** de ese item en eBay.es (sold listings de 90 días)
   - Calcula el **margen neto** tras comisión eBay (13%), procesamiento pago (2.9%), envío nacional (4.50€) y packaging (1€)
   - Si supera umbrales (≥ 8€ neto, ≥ 20% pct, score ≥ 65) → manda señal por Telegram
3. Persiste `seen_items.json`, `price_cache.json` y `stats.json` entre runs (auto-commit al repo)

## Perfiles actuales

| Perfil | Matches | Filtros clave |
|---|---|---|
| **vinilo** | vinilo, LP, 33 rpm | Excluye "rayado", "salta", sin portada. Valora NM/VG+/Mint |
| **funko** | funko, pop vinyl | Excluye "sin caja", "amarillo", "loose", "aplastada". Bonus exclusive/chase |

Añadir perfiles nuevos = escribir `src/profiles/<nombre>.js` siguiendo la firma de los existentes.

## Filtros de seguridad automáticos

- Precio < 3€ → descarte (truco SEO, no es precio real)
- Descripción con señales de fake ("réplica", "AAA") → descarte
- Título sin términos útiles tras limpiar stopwords → descarte
- Items reservados → penalización score -30 a -40

## Setup

### Local
```bash
npm install                    # sin dependencias externas, node 20+
DRY_RUN=1 npm start            # corre sin mandar Telegram, solo log
```

### GitHub Actions (producción)
1. Repo público = minutos Actions ilimitados
2. **Elige cómo recibir señales** (uno o varios):

   **Opción A · ntfy.sh** (recomendado, setup 30s, sin registro):
   - Instala app `ntfy` en móvil (iOS/Android)
   - Inventa un topic secreto (ej: `miguel-arb-xK7zp9qR`)
   - Suscríbete a ese topic desde la app
   - Configura secret `NTFY_TOPIC` en GitHub con ese valor

   **Opción B · Telegram** (bot clásico, setup 2 min):
   - Crea bot con `@BotFather` → obtén token
   - Obtén tu chat_id con `@userinfobot`
   - Configura secrets `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`

   Los dos pueden estar activos a la vez. El bot mandará por todos los canales configurados.

3. Workflow ejecuta cada 45 min + auto-commit del estado

## Configuración (`config.js`)

```js
KEYWORDS: ["vinilo lp", "funko exclusive", "funko lote"],
MIN_NET_MARGIN_EUR: 8,
MIN_MARGIN_PCT: 20,
MIN_SCORE: 65,
```

## Estructura

```
arbitrage-bot/
├── src/
│   ├── index.js               # orquestador
│   ├── evaluator.js           # selecciona perfil, aplica filtros, estima margen
│   ├── storage.js             # persistencia: seen, cache, stats
│   ├── notifier.js            # Telegram + signals.log
│   ├── sources/wallapop.js    # API interna Wallapop (sin auth)
│   ├── pricing/ebay.js        # scraping eBay.es sold listings
│   └── profiles/
│       ├── _base.js           # utilidades (norm, cleanSearchTerms, fake signals)
│       ├── vinilo.js
│       └── funko.js
├── .github/workflows/bot.yml
├── config.js
├── package.json
└── README.md
```

## Status: fase 0 (construcción)

Esto es versión inicial. El bot se auto-corrige iterativamente los primeros días:
- Detecta errores de parsing
- Afina filtros tras ver señales falsas positivas reales
- Ajusta cacheo según frecuencia real de ejecución

Cuando llegue a estado estable, el README se actualizará con métricas reales.
