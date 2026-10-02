// Network layer: most free market sources (Yahoo, RSS, Nasdaq) don't send CORS
// headers, so browser requests go through a proxy chain:
//   1. your own Cloudflare Worker (settings.proxyUrl)  <- fast + reliable
//   2. a direct request (works for CORS-friendly APIs such as Coinbase)
//   3. public CORS proxies (rate limited; fine for light personal use)
// The proxy that last succeeded is tried first next time.

const PUBLIC_PROXIES = [
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
];

let settings = { proxyUrl: '', usePublicProxies: true };
let preferred = null; // name of last-good route
export const netStats = { ok: 0, fail: 0, lastRoute: '' };

export function configureNet(s) { settings = s; preferred = null; }

function routes(url, { direct = false } = {}) {
  const list = [];
  if (settings.proxyUrl) {
    const base = settings.proxyUrl.replace(/\/+$/, '');
    list.push({ name: 'worker', url: `${base}/?url=${encodeURIComponent(url)}` });
  }
  if (direct) list.push({ name: 'direct', url });
  if (settings.usePublicProxies || !settings.proxyUrl) {
    PUBLIC_PROXIES.forEach((p, i) => list.push({ name: `public${i + 1}`, url: p(url) }));
  }
  if (preferred) list.sort((a, b) => (b.name === preferred) - (a.name === preferred));
  return list;
}

async function attempt(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

export async function fetchText(url, opts = {}) {
  const { timeoutMs = 9000, validate } = opts;
  let lastErr;
  if (opts.directFirst) {
    try {
      const text = await attempt(url, timeoutMs);
      if (!validate || validate(text)) { netStats.ok++; return text; }
    } catch (e) { lastErr = e; }
  }
  for (const route of routes(url, opts)) {
    try {
      const text = await attempt(route.url, timeoutMs);
      if (validate && !validate(text)) throw new Error('unexpected response');
      preferred = route.name;
      netStats.ok++; netStats.lastRoute = route.name;
      return text;
    } catch (e) { lastErr = e; }
  }
  netStats.fail++;
  throw new Error(`fetch failed (${url.slice(0, 60)}…): ${lastErr?.message || 'no route'}`);
}

export async function fetchJSON(url, opts = {}) {
  const text = await fetchText(url, {
    ...opts,
    validate: (t) => { try { JSON.parse(t); return true; } catch { return false; } },
  });
  return JSON.parse(text);
}

// Run async jobs with limited concurrency (be gentle on the proxies).
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = { ok: true, value: await fn(items[idx], idx) }; }
      catch (e) { out[idx] = { ok: false, error: e }; }
    }
  });
  await Promise.all(workers);
  return out;
}
