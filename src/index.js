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
  const fs = require("fs");
  const path = require("path");

  console.log(`\n🤖 Arbitrage Bot · run ${new Date().toISOString()}`);
  console.log(`   Keywords: ${config.KEYWORDS.join(", ")}`);
  console.log(`   Umbral: +${config.MIN_NET_MARGIN_EUR}€ net · ${config.MIN_MARGIN_PCT}% · score ${config.MIN_SCORE}`);
  console.log(`   DRY_RUN: ${config.DRY_RUN}\n`);

  // Reporte detallado (markdown) de este run
  const report = {
    timestamp: new Date().toISOString(),
    keywords: config.KEYWORDS,
    sections: {},   // keyword → { items: [...], summary }
  };

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

  let runItemsCount = 0;       // items NUEVOS (no vistos antes)
  let runItemsFetched = 0;     // items totales fetched de Wallapop (incluye ya vistos)
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

    // Si IGNORE_SEEN_ITEMS=true, reprocesa todo cada run (útil mientras afinamos filtros)
    const newItems = config.IGNORE_SEEN_ITEMS
      ? wpItems
      : wpItems.filter(i => !storage.isSeen(seen, i.id));
    runItemsCount += newItems.length;
    runItemsFetched += wpItems.length;
    byKw[keyword] = { items_today: newItems.length, signals_today: 0 };

    console.log(`   ${wpItems.length} items (${newItems.length} nuevos)`);

    // Sección de reporte para esta keyword
    const section = {
      total_items: wpItems.length,
      new_items: newItems.length,
      items: [],  // detalle por item
      signals: 0,
    };

    for (const item of newItems) {
      const itemReport = {
        title: item.title,
        price: item.price,
        city: item.city,
        url: item.url,
        reserved: item.reserved,
      };

      // Filtro mínimo: precio >= 3€ (evita 1€ truco SEO)
      if (item.price < 3) {
        storage.markSeen(seen, item.id);
        itemReport.verdict = "skip";
        itemReport.reason = "precio < 3€ (truco SEO)";
        section.items.push(itemReport);
        continue;
      }

      try {
        const result = await evaluate(item, ebay, cacheWrap, config);
        itemReport.profile = result.profile;
        itemReport.query_ebay = result.query;
        itemReport.ebay_count = result.ebay_count;
        itemReport.ebay_price_estimate = result.ebay_price_estimate;
        itemReport.margin_net = result.margin_net;
        itemReport.margin_pct = result.margin_pct;
        itemReport.score = result.score;
        itemReport.from_cache = result.from_cache;

        if (result.pass) {
          itemReport.verdict = "SIGNAL";
          console.log(`   ✓ SEÑAL: ${item.title.slice(0, 50)}... · +${result.margin_net}€ (${result.margin_pct}%) score ${result.score}`);
          await notify(item, result, config);
          runSignalsCount++;
          byKw[keyword].signals_today++;
          section.signals++;
        } else {
          itemReport.verdict = "skip";
          itemReport.reason = result.reason;
          if (config.VERBOSE) {
            console.log(`   · skip: ${item.title.slice(0, 40)}... · ${result.reason}`);
          }
        }
      } catch (e) {
        console.warn(`   ⚠️ Error evaluando ${item.id}:`, e.message);
        itemReport.verdict = "error";
        itemReport.reason = e.message;
      }

      section.items.push(itemReport);
      storage.markSeen(seen, item.id);
    }

    report.sections[keyword] = section;
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

  // Agregado de razones de descarte (para resumen Telegram)
  const discardsByReason = {};
  for (const section of Object.values(report.sections)) {
    for (const item of section.items) {
      if (item.verdict !== "SIGNAL" && item.reason) {
        discardsByReason[item.reason] = (discardsByReason[item.reason] || 0) + 1;
      }
    }
  }

  // Generar reporte markdown
  report.total_items = runItemsCount;
  report.total_signals = runSignalsCount;
  report.duration_s = dur;
  writeReport(report);

  // Enviar resumen silent a Telegram (no hace sonido, solo para saber que el bot vive)
  if (!config.DRY_RUN) {
    try {
      await notifyRunSummary({
        total_fetched: runItemsFetched,
        total_items: runItemsCount,
        total_signals: runSignalsCount,
        duration_s: dur,
        discards_by_reason: discardsByReason,
      }, config);
    } catch (e) {
      console.warn(`[summary] Error enviando resumen: ${e.message}`);
    }
  }
}

function writeReport(report) {
  const fs = require("fs");
  const path = require("path");
  const reportsDir = path.join(__dirname, "..", "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const mdPath = path.join(reportsDir, `run_${stamp}.md`);
  const jsonPath = path.join(reportsDir, `run_${stamp}.json`);
  const latestMdPath = path.join(reportsDir, "latest.md");

  let md = `# Run ${report.timestamp}\n\n`;
  md += `**${report.total_items} items nuevos · ${report.total_signals} señales · ${report.duration_s}s**\n\n`;
  md += `Umbrales: ≥${require("../config").MIN_NET_MARGIN_EUR}€ net · ≥${require("../config").MIN_MARGIN_PCT}% · score ≥${require("../config").MIN_SCORE}\n\n`;
  md += `---\n\n`;

  for (const [kw, section] of Object.entries(report.sections)) {
    md += `## 🔎 \`${kw}\`\n\n`;
    md += `${section.total_items} items totales · ${section.new_items} nuevos · **${section.signals} señales**\n\n`;

    const signals = section.items.filter(i => i.verdict === "SIGNAL");
    const evaluated = section.items.filter(i => i.verdict === "skip" && i.ebay_count);
    const filtered = section.items.filter(i => i.verdict === "skip" && !i.ebay_count);
    const errors = section.items.filter(i => i.verdict === "error");

    if (signals.length) {
      md += `### ✅ Señales (${signals.length})\n\n`;
      md += `| Item | Precio WP | eBay est | Margen | % | Score | Perfil |\n|---|---|---|---|---|---|---|\n`;
      for (const s of signals) {
        const title = truncate(s.title || "", 50);
        md += `| [${esc(title)}](${s.url}) | ${s.price}€ | ${s.ebay_price_estimate}€ (${s.ebay_count || "?"} sold) | +${s.margin_net}€ | ${s.margin_pct}% | ${s.score} | ${s.profile} |\n`;
      }
      md += `\n`;
    }

    if (evaluated.length) {
      md += `<details><summary>🔬 Evaluados pero no pasan umbral (${evaluated.length})</summary>\n\n`;
      md += `| Item | Precio WP | eBay est | Margen | % | Score | Razón |\n|---|---|---|---|---|---|---|\n`;
      for (const e of evaluated.slice(0, 30)) {
        const title = truncate(e.title || "", 45);
        md += `| [${esc(title)}](${e.url}) | ${e.price}€ | ${e.ebay_price_estimate || "?"}€ | ${e.margin_net || "?"}€ | ${e.margin_pct || "?"}% | ${e.score || "?"} | ${esc(e.reason || "")} |\n`;
      }
      if (evaluated.length > 30) md += `\n(+${evaluated.length - 30} más)\n`;
      md += `\n</details>\n\n`;
    }

    if (filtered.length) {
      md += `<details><summary>🚫 Filtrados antes de eBay (${filtered.length})</summary>\n\n`;
      const reasonGroups = {};
      for (const f of filtered) {
        const key = f.reason || "unknown";
        reasonGroups[key] = (reasonGroups[key] || 0) + 1;
      }
      md += `Razones agregadas:\n\n`;
      for (const [reason, count] of Object.entries(reasonGroups).sort((a,b)=>b[1]-a[1])) {
        md += `- **${count}×** ${esc(reason)}\n`;
      }
      md += `\nEjemplos (primeros 15):\n\n`;
      for (const f of filtered.slice(0, 15)) {
        md += `- \`${f.price}€\` ${esc(truncate(f.title || "", 65))} — _${esc(f.reason || "")}_\n`;
      }
      md += `\n</details>\n\n`;
    }

    if (errors.length) {
      md += `### ⚠️ Errores (${errors.length})\n\n`;
      for (const e of errors) {
        md += `- ${esc(e.title)} — ${esc(e.reason)}\n`;
      }
      md += `\n`;
    }
  }

  fs.writeFileSync(mdPath, md, "utf8");
  fs.writeFileSync(latestMdPath, md, "utf8");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`   📄 Reporte: reports/run_${stamp}.md`);
  console.log(`   📄 Última: reports/latest.md`);
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function esc(s) { return (s || "").replace(/[|<>]/g, ""); }

run().catch(e => {
  console.error("💥 Error fatal:", e);
  process.exit(1);
});
