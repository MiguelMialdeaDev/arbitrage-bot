// ============================================================
// Wallapop API interna (reverse engineered, sin auth)
// ============================================================

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "es-ES,es;q=0.9",
  "Origin": "https://es.wallapop.com",
  "Referer": "https://es.wallapop.com/",
  "X-DeviceOS": "0",
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function search(keyword, opts = {}) {
  const {
    lat = 40.4168, lng = -3.7038,
    pages = 2,
    delay = 800,
  } = opts;

  const all = [];
  for (let p = 0; p < pages; p++) {
    const url = `https://api.wallapop.com/api/v3/search?source=search_box&filters_source=search_box&keywords=${encodeURIComponent(keyword)}&latitude=${lat}&longitude=${lng}&order_by=newest&start=${p * 40}`;
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) {
        console.warn(`[wallapop] HTTP ${r.status} en "${keyword}" p${p}`);
        continue;
      }
      const j = await r.json();
      const items = j?.data?.section?.payload?.items || [];
      all.push(...items);
      if (items.length < 40) break;
      await sleep(delay);
    } catch (e) {
      console.warn(`[wallapop] Error en "${keyword}" p${p}:`, e.message);
    }
  }

  // Dedup por id + normalizar shape
  const seen = new Set();
  return all
    .filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; })
    .map(normalize);
}

function normalize(i) {
  return {
    id: i.id,
    user_id: i.user_id,
    title: i.title || "",
    description: i.description || "",
    price: i.price?.amount || 0,
    currency: i.price?.currency || "EUR",
    images: (i.images || []).map(img => img?.urls?.big || img?.urls?.medium).filter(Boolean),
    city: i.location?.city || null,
    region: i.location?.region || null,
    created_at: i.created_at,
    modified_at: i.modified_at,
    web_slug: i.web_slug,
    url: `https://es.wallapop.com/item/${i.web_slug}`,
    category_id: i.category_id,
    reserved: i.reserved?.flag === true,
    bump_active: i.bump?.type && i.bump.type !== "none",
    shipping_ok: i.shipping?.user_allows_shipping === true,
    is_top_profile: !!i.is_top_profile,
  };
}

async function getUserStats(userId, delay = 500) {
  try {
    const [stats, reviews, user] = await Promise.all([
      fetch(`https://api.wallapop.com/api/v3/users/${userId}/stats`, { headers: HEADERS }).then(r => r.ok ? r.json() : null),
      fetch(`https://api.wallapop.com/api/v3/users/${userId}/reviews`, { headers: HEADERS }).then(r => r.ok ? r.json() : null),
      fetch(`https://api.wallapop.com/api/v3/users/${userId}`, { headers: HEADERS }).then(r => r.ok ? r.json() : null),
    ]);
    const counters = {};
    (stats?.counters || []).forEach(c => counters[c.type] = c.value);
    const totalReviews = (reviews || []).length;
    const avgRating = user?.scoring_stars ?? null;
    return {
      sold: counters.sold || 0,
      publish: counters.publish || 0,
      reviews_count: totalReviews,
      rating: avgRating,
      name: user?.micro_name || "?",
    };
  } catch {
    return { sold: 0, publish: 0, reviews_count: 0, rating: null, name: "?" };
  } finally {
    await sleep(delay);
  }
}

// Análisis de mercado de un producto en Wallapop.
// Devuelve foto completa: activos, reservados, vendedores únicos (competencia),
// precios mínimos/mediana, samples para inspección.
async function searchSimilarItems(query, opts = {}) {
  const { lat = 40.4168, lng = -3.7038, pages = 3, delay = 600 } = opts;
  const items = await search(query, { lat, lng, pages, delay });
  const active = items.filter(i => !i.reserved);
  const reserved = items.filter(i => i.reserved);
  const activePrices = active.map(i => i.price).filter(p => p >= 3).sort((a, b) => a - b);
  const reservedPrices = reserved.map(i => i.price).filter(p => p >= 3).sort((a, b) => a - b);

  // Vendedores únicos = medida de competencia
  const uniqueSellers = new Set(items.map(i => i.user_id)).size;
  const uniqueActiveSellers = new Set(active.map(i => i.user_id)).size;

  const median = arr => arr.length ? arr[Math.floor(arr.length / 2)] : null;

  return {
    query,
    total: items.length,
    active_count: active.length,
    reserved_count: reserved.length,
    unique_sellers: uniqueSellers,
    unique_active_sellers: uniqueActiveSellers,
    active_prices: activePrices,
    reserved_prices: reservedPrices,
    active_min: activePrices[0] || null,
    active_median: median(activePrices),
    active_max: activePrices[activePrices.length - 1] || null,
    reserved_min: reservedPrices[0] || null,
    reserved_median: median(reservedPrices),
    reserved_max: reservedPrices[reservedPrices.length - 1] || null,
    reserved_items: reserved.slice(0, 5),
    active_items: active.slice(0, 10),
    all_items: items,
  };
}

module.exports = { search, getUserStats, searchSimilarItems };
