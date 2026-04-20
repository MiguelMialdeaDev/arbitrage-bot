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
  const confidence = evalResult.ebay_confidence === "high" ? "✓ alta" :
                     evalResult.ebay_confidence === "medium" ? "○ media" : "· baja";

  const lines = [
    `${emoji} <b>GANGA ${evalResult.margin_pct}% · +${evalResult.margin_net}€</b>`,
    ``,
    `📦 <b>${escapeHtml(truncate(wpItem.title, 80))}</b>`,
    `💰 Wallapop: <b>${wpItem.price}€</b> → eBay.es est: ${evalResult.ebay_price_estimate}€ (${evalResult.ebay_count} sold, ${confidence})`,
    `📍 ${wpItem.city || "?"}${wpItem.region ? `, ${wpItem.region}` : ""}`,
    `⏱️ hace ${ageMinutes(wpItem.created_at)} min`,
    `🏷️ ${evalResult.profile}${evalResult.viability?.is_exclusive ? " · exclusive" : ""}${evalResult.viability?.grade_hint ? ` · ${evalResult.viability.grade_hint}` : ""}`,
    `📋 score ${evalResult.score}/100`,
    ``,
    `🔗 <a href="${wpItem.url}">Abrir en Wallapop</a>`,
  ];
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
      disable_web_page_preview: false,
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

async function notifyRunSummary(stats, config) {
  const lines = [
    `📊 <b>Bot arbitraje · resumen</b>`,
    `🔄 Runs acumulados: ${stats.runs}`,
    `📦 Items fetched hoy: ${stats.last_run_items || 0}`,
    `🎯 Señales nuevas: ${stats.last_run_signals || 0}`,
    `📨 Total señales enviadas: ${stats.total_signals_sent}`,
    ``,
    ...Object.entries(stats.by_keyword || {}).map(([k, s]) =>
      `  · ${k}: ${s.items_today || 0} items, ${s.signals_today || 0} señales`
    ),
  ];
  if (config.DRY_RUN) {
    console.log("[DRY SUMMARY]\n" + lines.join("\n"));
    return;
  }
  await sendTelegram(lines.join("\n"));
}

module.exports = { notify, notifyRunSummary, formatSignal };
