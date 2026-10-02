// TTT Terminal — private CORS proxy (Cloudflare Worker, free tier: 100k req/day)
//
// Deploy: Cloudflare dashboard → Workers & Pages → Create → "Hello World" worker
// → Edit code → paste this file → Deploy. Then put the worker URL into the
// terminal's Settings → "Your CORS proxy URL".
//
// Only hosts on the allow-list below can be fetched, so the worker can't be
// abused as an open proxy. Add hosts here if you add custom feeds.

const ALLOWED_HOSTS = [
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'finance.yahoo.com',
  'api.nasdaq.com',
  'nfs.faireconomy.media',
  'api.exchange.coinbase.com',
  'feeds.content.dowjones.io',
  'search.cnbc.com', 'www.cnbc.com',
  'www.investing.com',
  'news.google.com',
  'www.federalreserve.gov',
  'oilprice.com',
  'seekingalpha.com',
  'www.coindesk.com',
];

// Lock the proxy to your site. Add http://localhost:8000 etc. for local testing.
const ALLOWED_ORIGINS = [
  'https://thetiltedtrader.github.io',
  'https://thetiltedtraders.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const CACHE_SECONDS = {
  'query1.finance.yahoo.com': 20,
  'query2.finance.yahoo.com': 20,
  'api.exchange.coinbase.com': 15,
  'api.nasdaq.com': 1800,
  'nfs.faireconomy.media': 1800,
};

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response('Origin not allowed', { status: 403, headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('Missing or bad ?url=', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response(`Host not allowed: ${url.hostname}`, { status: 403, headers: cors });
    }

    const ttl = CACHE_SECONDS[url.hostname] ?? 120;
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    let res = await cache.match(cacheKey);
    if (!res) {
      const upstream = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
          'Accept': 'application/json, application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
      res = new Response(upstream.body, upstream);
      res.headers.set('Cache-Control', `public, max-age=${ttl}`);
      if (upstream.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};
