// ============================================================
// Notifier: envía señales a Telegram (o log si DRY_RUN)
// ============================================================

const fs = require("fs");
const path = require("path");
const { appendSignalLog } = require("./storage");

const TELEGRAM_API = "https://api.telegram.org/bot";
const NTFY_URL = "https://ntfy.sh";

function formatSignal(wpItem, evalResult) {
  const emoji = evalResult.margin_pct >= 50 ? "🟢" : evalResult.margin_pct >= 30 ? "🟡" : "🔵";

  // Análisis de mercado Wallapop
  const marketLines = [];
  if (evalResult.wallapop_check) {
    const wc = evalResult.wallapop_check;
    marketLines.push(`💰 <b>${wpItem.price}€</b> vs mín reservado <b>${wc.reserved_min}€</b>`);
    marketLines.push(`📦 Reservados: ${wc.reserved_count} (mediana ${wc.reserved_median || '?'}€)`);
    marketLines.push(`📊 Activos: ${wc.active_count} (mín ${wc.active_min || '?'}€)`);
    marketLines.push(`👥 Competencia: ${wc.unique_active_sellers} vendedores activos`);
  } else {
    const confidence = evalResult.ebay_confidence === "high" ? "✓ alta" : "○ media";
    marketLines.push(`💰 Wallapop: <b>${wpItem.price}€</b> → eBay: ${evalResult.ebay_price_estimate}€ (${evalResult.ebay_count} sold, ${confidence})`);
  }
  const priceRefLine = marketLines.join("\n");

  const lines = [
    `${emoji} <b>GANGA ${evalResult.margin_pct}% · +${evalResult.margin_net}€</b>`,
    ``,
    `📦 <b>${escapeHtml(truncate(wpItem.title, 80))}</b>`,
    priceRefLine,
    `📍 ${wpItem.city || "?"}${wpItem.region ? `, ${wpItem.region}` : ""}`,
    `⏱️ hace ${ageMinutes(wpItem.created_at)} min`,
    `🏷️ ${evalResult.profile}${evalResult.viability?.is_exclusive ? " · exclusive" : ""}${evalResult.viability?.grade_hint ? ` · ${evalResult.viability.grade_hint}` : ""}`,
    `📋 score ${evalResult.score}/100`,
    ``,
    `🔗 <a href="${wpItem.url}">Abrir en Wallapop</a>`,
  ].filter(l => l !== "");
  return lines.join("\n");
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function ageMinutes(tsMs) {
  return Math.max(0, Math.round((Date.now() - tsMs) / 60000));
}

async function sendTelegram(msg, opts = {}) {
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) {
    return { ok: false, error: "no token/chat configured", skipped: true };
  }
  try {
    const url = `${TELEGRAM_API}${TOKEN}/sendMessage`;
    const body = {
      chat_id: CHAT_ID,
      text: msg,
      parse_mode: "HTML",
      disable_web_page_preview: opts.silent ? true : false,
      disable_notification: !!opts.silent,  // sin sonido si silent=true
    };
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}`, body: await r.text() };
    return { ok: true, channel: "telegram" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendNtfy(msg, opts = {}) {
  const TOPIC = process.env.NTFY_TOPIC;
  if (!TOPIC) return { ok: false, error: "no ntfy topic configured", skipped: true };
  try {
    // ntfy no soporta HTML, convertimos a texto plano limpiando tags
    const plainText = stripHtml(msg);
    const title = opts.title || "🎯 Ganga detectada";
    const clickUrl = opts.clickUrl || "";
    const priority = opts.priority || "high";  // high = notificación push prioritaria

    const r = await fetch(`${NTFY_URL}/${encodeURIComponent(TOPIC)}`, {
      method: "POST",
      headers: {
        "Title": encodeHeader(title),
        "Priority": priority,
        "Tags": opts.tags || "moneybag",
        ...(clickUrl ? { "Click": clickUrl } : {}),
      },
      body: plainText,
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true, channel: "ntfy" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function stripHtml(s) {
  return (s || "")
    .replace(/<b>/gi, "*").replace(/<\/b>/gi, "*")
    .replace(/<i>/gi, "_").replace(/<\/i>/gi, "_")
    .replace(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ntfy HTTP headers no aceptan emoji / UTF-8 directo, usamos RFC 2047
function encodeHeader(s) {
  // Solo ASCII → devolver tal cual; else, codificación base64 UTF-8
  if (/^[\x20-\x7E]+$/.test(s)) return s;
  const b64 = Buffer.from(s, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

async function notify(wpItem, evalResult, config) {
  const msg = formatSignal(wpItem, evalResult);

  // Log siempre (incluso si hay Telegram/ntfy)
  const logEntry = `[${new Date().toISOString()}] [${evalResult.score}] ${wpItem.url} · ${wpItem.price}€ → ${evalResult.ebay_price_estimate}€ · +${evalResult.margin_net}€`;
  appendSignalLog(logEntry);

  if (config.DRY_RUN) {
    console.log(`[DRY] ${logEntry}`);
    console.log(msg);
    return { ok: true, dry: true };
  }

  // Enviar por TODOS los canales configurados en paralelo (ntfy + telegram si ambos existen)
  const title = `🎯 Ganga ${evalResult.margin_pct}% · +${evalResult.margin_net}€`;
  const ntfyOpts = { title, clickUrl: wpItem.url, priority: evalResult.margin_pct >= 50 ? "max" : "high", tags: "moneybag" };

  const [tg, nf] = await Promise.all([
    sendTelegram(msg),
    sendNtfy(msg, ntfyOpts),
  ]);

  const delivered = [tg, nf].filter(r => r.ok).map(r => r.channel);
  const failures = [tg, nf].filter(r => !r.ok && !r.skipped);

  if (delivered.length === 0) {
    const reasons = failures.map(f => f.error).concat(
      [tg.skipped ? "telegram skipped" : null, nf.skipped ? "ntfy skipped" : null].filter(Boolean)
    ).join("; ");
    console.warn(`[notifier] Sin canales activos: ${reasons}`);
    return { ok: false, error: "no channels active" };
  }

  if (failures.length) {
    console.warn(`[notifier] Algunos canales fallaron:`, failures.map(f => f.error).join(", "));
  }

  return { ok: true, channels: delivered };
}

// Resumen del run: se envía SILENT (sin sonido) tras cada ejecución
// para que veas que el bot está vivo sin molestarte como señal real.
async function notifyRunSummary(summary, config) {
  const {
    total_fetched = 0, total_items, total_signals, duration_s,
    discards_by_reason = {},
  } = summary;

  // Top 6 razones de descarte
  const topReasons = Object.entries(discards_by_reason)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const lines = [
    `📊 <b>Run resumen</b>`,
    `<i>${total_fetched} fetched · ${total_items} nuevos · ${total_signals} señales · ${duration_s}s</i>`,
    ``,
  ];

  if (topReasons.length) {
    lines.push("<b>Top descartes:</b>");
    for (const [reason, count] of topReasons) {
      const short = reason.length > 60 ? reason.slice(0, 57) + "…" : reason;
      lines.push(`  • ${count}× ${short}`);
    }
  } else if (total_fetched > 0 && total_items === 0) {
    lines.push("<i>Todos los items ya se procesaron en runs previos. Esperando nuevos listings en Wallapop.</i>");
  } else if (total_fetched === 0) {
    lines.push("<i>⚠️ 0 items fetched — posible problema de red/rate limit</i>");
  } else {
    lines.push("<i>Sin descartes (todos los nuevos pasaron filtros básicos)</i>");
  }

  const text = lines.join("\n");

  if (config.DRY_RUN) {
    console.log("[DRY SUMMARY]\n" + text);
    return;
  }

  // Enviar silent (sin sonido) — solo las señales reales hacen sonido
  await sendTelegram(text, { silent: true });
}

// Notificación cuando un modelo sube de tier (💡 → 📈 → ✨ → 🔥 → 🚀).
// Un solo mensaje por run con todos los tier-ups detectados.
async function notifyTierUps(tierUps, config) {
  if (!tierUps || !tierUps.length) return { ok: true, skipped: true };

  const lines = [`🎯 <b>${tierUps.length} modelo(s) subieron de tier</b>`, ""];
  for (const up of tierUps.slice(0, 8)) {
    const e = up.entry || {};
    const title = escapeHtml(truncate(e.example_title || up.model, 60));
    const priceLine = e.min_price && e.max_price
      ? `${e.min_price === e.max_price ? e.min_price + "€" : e.min_price + "-" + e.max_price + "€"}`
      : "";
    const counts = [
      e.reservations_24h ? `${e.reservations_24h}/24h` : null,
      e.reservations_7d  ? `${e.reservations_7d}/7d`   : null,
      e.reservations_30d ? `${e.reservations_30d}/30d` : null,
      e.confirmed_sales  ? `${e.confirmed_sales} ventas` : null,
    ].filter(Boolean).join(" · ");

    lines.push(`${up.from_label} → <b>${up.to_label}</b>`);
    lines.push(`📦 ${title}`);
    if (priceLine) lines.push(`💰 ${priceLine}${counts ? " · " + counts : ""}`);
    if (e.example_url) lines.push(`🔗 <a href="${e.example_url}">Ver en Wallapop</a>`);
    lines.push("");
  }
  if (tierUps.length > 8) lines.push(`<i>+${tierUps.length - 8} más</i>`);

  const msg = lines.join("\n");
  if (config.DRY_RUN) {
    console.log("[DRY TIER-UP]\n" + msg);
    return { ok: true, dry: true };
  }
  return sendTelegram(msg, { silent: false });
}

module.exports = { notify, notifyRunSummary, notifyTierUps, formatSignal };
