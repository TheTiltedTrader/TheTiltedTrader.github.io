// Network layer: most free market sources (Yahoo, RSS, Nasdaq) don't send CORS
// headers, so the browser can't read them directly. Routes, in order:
//   1. the local data helper (Start-Terminal.bat → http://localhost:8787)  <- recommended
//   2. your own proxy URL from Settings (Cloudflare Worker or the local helper)
//   3. a direct request (works for CORS-friendly APIs such as Coinbase)
//   4. public CORS proxies, raced in parallel (unreliable; many now need API keys)

const PUBLIC_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
];

// Set by TTT-Server.ps1 when it serves the page.
const LOCAL_HELPER = typeof window !== 'undefined' && window.TTT_LOCAL_PROXY && /^https?:$/.test(location.protocol)
  ? location.origin : '';

let settings = { proxyUrl: '', usePublicProxies: true };
export const netStats = { ok: 0, fail: 0, lastRoute: '' };

export function configureNet(s) { settings = s; }
export const hasPrivateRoute = () => Boolean(LOCAL_HELPER || settings.proxyUrl);
export const routeLabel = () => LOCAL_HELPER ? 'local helper' : settings.proxyUrl ? 'your proxy' : 'public proxies only';

const viaBase = (base, u) => `${base.replace(/\/+$/, '')}/?url=${encodeURIComponent(u)}`;

async function attempt(url, timeoutMs, validate, signal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs);
  const onAbort = () => ctrl.abort(new Error('cancelled'));
  signal?.addEventListener('abort', onAbort);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (validate && !validate(text)) throw new Error('unexpected response');
    return text;
  } catch (e) {
    throw ctrl.signal.aborted && ctrl.signal.reason instanceof Error ? ctrl.signal.reason : e;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchText(url, opts = {}) {
  const { timeoutMs = 12000, validate } = opts;
  const sequential = [];
  if (opts.directFirst) sequential.push({ name: 'direct', url });
  if (LOCAL_HELPER) sequential.push({ name: 'local helper', url: viaBase(LOCAL_HELPER, url) });
  if (settings.proxyUrl) sequential.push({ name: 'your proxy', url: viaBase(settings.proxyUrl, url) });
  if (opts.direct && !opts.directFirst) sequential.push({ name: 'direct', url });

  let lastErr;
  for (const route of sequential) {
    try {
      const text = await attempt(route.url, timeoutMs, validate);
      netStats.ok++; netStats.lastRoute = route.name;
      return text;
    } catch (e) { lastErr = e; }
  }

  if (settings.usePublicProxies || !hasPrivateRoute()) {
    const stop = new AbortController();
    try {
      const text = await Promise.any(PUBLIC_PROXIES.map(p => attempt(p(url), timeoutMs, validate, stop.signal)));
      netStats.ok++; netStats.lastRoute = 'public proxy';
      return text;
    } catch (e) {
      lastErr = e.errors?.[0] || e;
    } finally { stop.abort(); }
  }

  netStats.fail++;
  if (!hasPrivateRoute()) {
    throw new Error('no data connection: open the terminal with Start-Terminal.bat (or set a proxy in Settings). Free public proxies are not responding.');
  }
  throw new Error(`${new URL(url).hostname}: ${lastErr?.message || 'failed'}`);
}

export async function fetchJSON(url, opts = {}) {
  const text = await fetchText(url, {
    ...opts,
    validate: (t) => { try { JSON.parse(t); return true; } catch { return false; } },
  });
  return JSON.parse(text);
}

// Run async jobs with limited concurrency (be gentle on the sources).
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
