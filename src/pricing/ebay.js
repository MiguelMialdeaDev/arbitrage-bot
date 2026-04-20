// ============================================================
// eBay.es sold listings scraper (sin API key)
// ============================================================

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

const USD_TO_EUR = 0.92;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchListingFromDomain(query, domain, soldMode) {
  const soldParam = soldMode ? "&LH_Sold=1&LH_Complete=1" : "";
  const url = `https://www.ebay.${domain}/sch/i.html?_nkw=${encodeURIComponent(query)}${soldParam}&_ipg=120`;
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: "follow" });
    if (!r.ok) return { prices: [], error: `HTTP ${r.status}`, domain };
    if (r.url.includes("/splashui/challenge") || r.url.includes("captcha")) {
      return { prices: [], error: "blocked by captcha", domain };
    }
    const html = await r.text();
    if (!html || html.length < 5000) return { prices: [], error: "empty response", domain };
    if (/splashui\/challenge|captcha|Bitte bestätigen Sie/i.test(html)) {
      return { prices: [], error: "captcha in body", domain };
    }
    const prices = extractPrices(html);
    return { prices, domain, query };
  } catch (e) {
    return { prices: [], error: e.message, domain };
  }
}

async function fetchSoldPricesFromDomain(query, domain) {
  return fetchListingFromDomain(query, domain, true);
}

async function fetchActiveFromDomain(query, domain) {
  return fetchListingFromDomain(query, domain, false);
}

// Intenta eBay.es, si falla hace fallback a eBay.de
async function fetchSoldPrices(query, opts = {}) {
  const { delay = 1500, domains = ["es", "de"] } = opts;
  let lastError = null;
  for (const domain of domains) {
    const result = await fetchSoldPricesFromDomain(query, domain);
    if (result.prices && result.prices.length >= 3) {
      await sleep(delay);
      return result;
    }
    lastError = result.error;
    await sleep(500);
  }
  await sleep(delay);
  return { prices: [], error: lastError || "no data", query };
}

// Fetch combinado: sold + active. Da señal de demanda y competencia.
// - sold_count: vendidos recientes (≈ 90 días)
// - active_count: compiten contigo ahora mismo
// - velocity_ratio: sold/active → >1 rápido, <0.5 saturado
async function fetchMarketData(query, opts = {}) {
  const { delay = 1500, domains = ["es", "de"] } = opts;
  let soldResult = { prices: [], domain: null };
  let activeResult = { prices: [], domain: null };
  let lastError = null;

  for (const domain of domains) {
    const [sold, active] = await Promise.all([
      fetchSoldPricesFromDomain(query, domain),
      fetchActiveFromDomain(query, domain),
    ]);
    // Acepta el dominio si sold da datos útiles
    if (sold.prices && sold.prices.length >= 3) {
      soldResult = sold;
      activeResult = active;
      break;
    }
    lastError = sold.error;
    await sleep(500);
  }

  await sleep(delay);

  const soldCount = soldResult.prices?.length || 0;
  const activeCount = activeResult.prices?.length || 0;
  const velocityRatio = activeCount > 0 ? soldCount / activeCount : null;

  return {
    sold: soldResult.prices || [],
    active: activeResult.prices || [],
    sold_count: soldCount,
    active_count: activeCount,
    velocity_ratio: velocityRatio,
    domain: soldResult.domain,
    error: soldCount === 0 ? lastError : null,
  };
}

// Extrae precios desde s-card__price y hace matching por aria-label + precio
function extractPrices(html) {
  const prices = [];

  // Método 1: s-card__price (eBay.es/.com nuevo formato)
  const cardMatches = [...html.matchAll(/s-card__price[^>]*>([^<]+)</g)];
  for (const m of cardMatches) {
    const p = parsePriceString(m[1]);
    if (p && p >= 3 && p < 20000) prices.push(p);
  }

  // Si no hay suficientes s-card__price, fallback a aria-label
  if (prices.length < 5) {
    const ariaMatches = [...html.matchAll(/aria-label="([^"]{20,200})"/g)];
    for (const m of ariaMatches) {
      const title = m[1];
      // Saltar labels que no son items
      if (/búsqueda|Guardar|Filter|kostenlos|Versand|Sortieren|Ordenar/i.test(title)) continue;
      // Buscar precio cercano (primeros 3000 chars)
      const after = html.slice(m.index, m.index + 3000);
      const priceMatch = after.match(/(EUR\s*\d+[,.]\d{2}|\d+[,.]\d{2}\s*EUR|\$\d+\.\d{2})/);
      if (priceMatch) {
        const p = parsePriceString(priceMatch[0]);
        if (p && p >= 3 && p < 20000) prices.push(p);
      }
    }
  }

  return prices;
}

function parsePriceString(s) {
  if (!s) return null;
  s = s.trim();
  // Formato EUR X,XX
  let m = s.match(/([0-9]+)[,.]([0-9]{2})\s*EUR/);
  if (m) return parseFloat(`${m[1]}.${m[2]}`);
  m = s.match(/EUR\s*([0-9]+)[,.]([0-9]{2})/);
  if (m) return parseFloat(`${m[1]}.${m[2]}`);
  // Formato USD $X.XX
  m = s.match(/\$([0-9]+)\.([0-9]{2})/);
  if (m) return parseFloat(`${m[1]}.${m[2]}`) * USD_TO_EUR;
  // Formato genérico X,XX €
  m = s.match(/([0-9]+)[,.]([0-9]{2})\s*€/);
  if (m) return parseFloat(`${m[1]}.${m[2]}`);
  return null;
}

function stats(prices) {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  return {
    count: prices.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    median: sorted[Math.floor(sorted.length * 0.5)],
    p75: sorted[Math.floor(sorted.length * 0.75)],
    mean: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length * 100) / 100,
  };
}

// Precio conservador: el mínimo que se REPITE al menos N veces (±15%).
// Esto representa el "precio competitivo real" al que tendrías que vender,
// no la mediana ruidosa. Evita outliers únicos y da confianza real.
function estimateCompetitivePrice(prices, minRepetitions = 3, tolerance = 0.15) {
  if (!prices || prices.length < minRepetitions) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  // Buscar el precio más bajo que tenga ≥ N vecinos dentro de ±15%
  for (let i = 0; i < sorted.length; i++) {
    const base = sorted[i];
    const low = base * (1 - tolerance);
    const high = base * (1 + tolerance);
    const cluster = sorted.filter(p => p >= low && p <= high);
    if (cluster.length >= minRepetitions) {
      // Precio competitivo = mediana del cluster (precio estable que se repite)
      const clusterMedian = cluster[Math.floor(cluster.length / 2)];
      return {
        price: Math.round(clusterMedian * 100) / 100,
        cluster_size: cluster.length,
        cluster_min: cluster[0],
        cluster_max: cluster[cluster.length - 1],
        total_samples: prices.length,
      };
    }
  }
  return null;
}

module.exports = { fetchSoldPrices, fetchMarketData, extractPrices, stats, estimateCompetitivePrice };
