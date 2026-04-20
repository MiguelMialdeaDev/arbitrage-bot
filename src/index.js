// ============================================================
// Arbitrage Bot · Orquestador principal
//
// Flujo:
//   1. Por cada keyword configurada, busca items nuevos en Wallapop
//   2. Para cada item nuevo, elige perfil y aplica filtros
//   3. Busca precio específico en eBay.es (con cache 24h)
//   4. Calcula margen y score
//   5. Si pasa umbral, envía señal por Telegram
//   6. Persiste estado (seen + cache + stats)
// ============================================================

const wallapop = require("./sources/wallapop");
const ebay = require("./pricing/ebay");
const storage = require("./storage");
const { evaluate } = require("./evaluator");
const { notify, notifyRunSummary } = require("./notifier");
const config = require("../config");

async function run() {
  const tStart = Date.now();
  console.log(`\n🤖 Arbitrage Bot · run ${new Date().toISOString()}`);
  console.log(`   Keywords: ${config.KEYWORDS.join(", ")}`);
  console.log(`   Umbral: +${config.MIN_NET_MARGIN_EUR}€ net · ${config.MIN_MARGIN_PCT}% · score ${config.MIN_SCORE}`);
  console.log(`   DRY_RUN: ${config.DRY_RUN}\n`);

  const seen = storage.loadSeen();
  const cache = storage.loadCache();
  const stats = storage.loadStats();
  stats.runs = (stats.runs || 0) + 1;
  stats.last_run = new Date().toISOString();

  // Wrapper cache para evaluator
  const cacheWrap = {
    getCached: (q) => storage.getCachedPrice(cache, q, config.EBAY_PRICE_CACHE_TTL_HOURS),
    setCached: (q, data) => storage.setCachedPrice(cache, q, data),
  };

  let runItemsCount = 0;
  let runSignalsCount = 0;
  const byKw = {};

  for (const keyword of config.KEYWORDS) {
    console.log(`\n━━━ ${keyword} ━━━`);
    const wpItems = await wallapop.search(keyword, {
      lat: config.WALLAPOP_LAT,
      lng: config.WALLAPOP_LNG,
      pages: config.WALLAPOP_PAGES,
      delay: config.WALLAPOP_DELAY,
    });

    const newItems = wpItems.filter(i => !storage.isSeen(seen, i.id));
    runItemsCount += newItems.length;
    byKw[keyword] = { items_today: newItems.length, signals_today: 0 };

    console.log(`   ${wpItems.length} items (${newItems.length} nuevos)`);

    for (const item of newItems) {
      // Filtro mínimo: precio >= 3€ (evita 1€ truco SEO)
      if (item.price < 3) {
        storage.markSeen(seen, item.id);
        continue;
      }

      try {
        const result = await evaluate(item, ebay, cacheWrap, config);
        if (result.pass) {
          console.log(`   ✓ SEÑAL: ${item.title.slice(0, 50)}... · +${result.margin_net}€ (${result.margin_pct}%) score ${result.score}`);
          await notify(item, result, config);
          runSignalsCount++;
          byKw[keyword].signals_today++;
        } else if (config.VERBOSE) {
          console.log(`   · skip: ${item.title.slice(0, 40)}... · ${result.reason}`);
        }
      } catch (e) {
        console.warn(`   ⚠️ Error evaluando ${item.id}:`, e.message);
      }

      storage.markSeen(seen, item.id);
    }
  }

  // Actualizar stats
  stats.total_wp_items_fetched = (stats.total_wp_items_fetched || 0) + runItemsCount;
  stats.total_signals_sent = (stats.total_signals_sent || 0) + runSignalsCount;
  stats.last_run_items = runItemsCount;
  stats.last_run_signals = runSignalsCount;
  stats.by_keyword = byKw;

  // Persistir
  storage.saveSeen(seen);
  storage.saveCache(cache);
  storage.saveStats(stats);

  const dur = Math.round((Date.now() - tStart) / 1000);
  console.log(`\n━━━ FIN ━━━`);
  console.log(`   ${runItemsCount} items nuevos analizados`);
  console.log(`   ${runSignalsCount} señales enviadas`);
  console.log(`   Duración: ${dur}s\n`);
}

run().catch(e => {
  console.error("💥 Error fatal:", e);
  process.exit(1);
});
