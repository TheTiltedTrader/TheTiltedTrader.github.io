// Default settings + persistence. Everything here is editable from the
// Settings panel (press S) and is stored in this browser's localStorage.

// Storage keys keep the original 'ttt.' prefix so saved settings (incl. the
// data-connection URL) survive renames of the terminal.
const STORE_KEY = 'ttt.terminal.settings.v1';

export const DEFAULTS = {
  // Your own CORS proxy (see terminal/proxy/README.md). Strongly recommended:
  // public proxies work but are rate limited and occasionally down.
  proxyUrl: '',
  usePublicProxies: true,

  autoRefreshSec: 120,          // 0 = off
  trendHours: [4, 8],           // the two lookback windows shown in the trend monitor
  overnightStartHourET: 16,     // "overnight" news window starts at prior cash close
  sessionStartHourET: 18,       // CME Globex session open (used for ON high/low, VWAP)

  // label | data symbol (Yahoo, or coinbase:PRODUCT) | TradingView symbol | decimals | tick size
  instruments: [
    { label: 'ES',  name: 'S&P 500 E-mini',      src: 'ES=F',             tv: 'OANDA:SPX500USD', dp: 2, tick: 0.25 },
    { label: 'NQ',  name: 'Nasdaq 100 E-mini',   src: 'NQ=F',             tv: 'OANDA:NAS100USD', dp: 2, tick: 0.25 },
    { label: 'RTY', name: 'Russell 2000 E-mini', src: 'RTY=F',            tv: 'OANDA:US2000USD', dp: 1, tick: 0.1 },
    { label: 'CL',  name: 'Crude Oil WTI',       src: 'CL=F',             tv: 'TVC:USOIL',       dp: 2, tick: 0.01 },
    { label: 'GC',  name: 'Gold',                src: 'GC=F',             tv: 'TVC:GOLD',        dp: 1, tick: 0.1 },
    { label: 'SI',  name: 'Silver',              src: 'SI=F',             tv: 'TVC:SILVER',      dp: 3, tick: 0.005 },
    { label: 'BTC', name: 'Bitcoin',             src: 'coinbase:BTC-USD', tv: 'COINBASE:BTCUSD', dp: 0, tick: 1 },
  ],

  indices: [
    { label: 'SPX',   src: '^GSPC',    dp: 2 },
    { label: 'NDX',   src: '^NDX',     dp: 2 },
    { label: 'DJIA',  src: '^DJI',     dp: 2 },
    { label: 'RUT',   src: '^RUT',     dp: 2 },
    { label: 'VIX',   src: '^VIX',     dp: 2 },
    { label: 'DXY',   src: 'DX-Y.NYB', dp: 3 },
    { label: 'US10Y', src: '^TNX',     dp: 3 },
    { label: 'NKY',   src: '^N225',    dp: 0 },
    { label: 'DAX',   src: '^GDAXI',   dp: 0 },
  ],

  feeds: [
    { name: 'MarketWatch RT',   url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines' },
    { name: 'MarketWatch Top',  url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
    { name: 'CNBC Top',         url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
    { name: 'CNBC Economy',     url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258' },
    { name: 'CNBC Earnings',    url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135' },
    { name: 'Yahoo Finance',    url: 'https://finance.yahoo.com/news/rssindex' },
    { name: 'Investing Econ',   url: 'https://www.investing.com/rss/news_14.rss' },
    { name: 'Yahoo: Index Futures', url: 'https://finance.yahoo.com/rss/headline?s=ES%3DF,NQ%3DF,RTY%3DF,%5EGSPC,%5EIXIC,%5ERUT,CL%3DF,GC%3DF' },
    { name: 'Investing Stocks', url: 'https://www.investing.com/rss/news_25.rss' },
    { name: 'Investing Econ Data', url: 'https://www.investing.com/rss/news_95.rss' },
    { name: 'Federal Reserve',  url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
    { name: 'Truth Social: Trump', url: 'https://www.trumpstruth.org/feed' },
    { name: 'OilPrice',         url: 'https://oilprice.com/rss/main' },
  ],

  // Folder name: comma-separated keywords (case-insensitive, whole words + plurals)
  folders: [
    { name: 'Fed & Rates',   keys: 'fed, fomc, powell, rate cut, rate hike, interest rate, treasury, yields, bond, waller, williams, jefferson, bowman, barr, goolsbee, daly, logan, kashkari, hammack, musalem, schmid, dot plot, balance sheet, central bank, ecb, boj, lagarde, ueda' },
    { name: 'Data & Inflation', keys: 'cpi, ppi, pce, inflation, payrolls, nonfarm, jobs report, jobless claims, unemployment, gdp, retail sales, ism, pmi, consumer confidence, consumer sentiment, housing starts, durable goods, jolts, adp' },
    { name: 'Earnings',      keys: 'earnings, guidance, revenue, eps, quarterly, results, outlook, forecast, beats, misses, profit warning, buyback' },
    { name: 'Geopolitics',   keys: 'war, missile, attack, sanctions, tariff, trade war, china, russia, ukraine, israel, iran, taiwan, north korea, strike, ceasefire, election, white house, trump, congress, shutdown, debt ceiling' },
    { name: 'Energy & Metals', keys: 'oil, crude, opec, brent, wti, natural gas, gasoline, gold, silver, copper, refinery, inventories, eia' },
    { name: 'Tech & AI',     keys: 'nvidia, apple, microsoft, alphabet, google, amazon, meta, tesla, broadcom, amd, semiconductor, chip, ai, openai, anthropic, data center' },
    { name: 'Crypto',        keys: 'bitcoin, btc, crypto, ether, ethereum, stablecoin, coinbase, etf flows, microstrategy, strategy inc' },
  ],

  // Words that push a headline up the "high impact" ranking.
  impactKeys: 'breaking, surge, plunge, plunges, tumble, tumbles, soar, soars, crash, selloff, sell-off, rally, record, emergency, halt, halted, default, downgrade, bankruptcy, surprise, unexpected, hot, cooler, hawkish, dovish, rate cut, rate hike, fomc, cpi, payrolls, jobs report, tariff, sanctions, war, attack, opec, guidance, warns, slashes, raises, misses, beats, layoffs, investigation, sec, doj',

  earningsMinCapB: 40,          // show earnings for companies >= this market cap ($B)
  earningsWatchlist: 'NVDA, AAPL, MSFT, GOOGL, AMZN, META, TSLA, AVGO, AMD, NFLX, JPM, GS, MS, BAC, WFC, C, UNH, LLY, XOM, CVX, WMT, COST, ORCL, CRM, ADBE, MU, INTC, QCOM, TSM, ASML, NKE, FDX, MCD, DIS, BA, CAT, PLTR, SMCI, ARM, COIN, MSTR',

  // ---- market-reaction impact rules (see js/impact.js) ----
  // HIGH impact only if, within impactWindowMin of the news, a US index future
  // moves >= impactFutPct or a Mag 10 stock the news is about moves >= impactMagPct.
  impactFutures: 'ES=F, NQ=F, RTY=F, YM=F',
  mag10: 'AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, AVGO, ORCL, NFLX',
  impactFutPct: 0.30,
  impactMinFutures: 2,          // how many of the index futures must make that move
  impactMagPct: 0.50,
  impactWindowMin: 15,

  heatmapSource: 'SPX500',      // SPX500, NASDAQ100, DJDJI, AllUSA ...
  chartInterval: '5',

  anthropicKey: '',
  aiModel: 'claude-opus-5-5',
  aiAutoMin: 30,                // auto-regenerate the AI brief this often (0 = manual only)
  migrations: [],

  panels: {
    trend: true, brief: true, heatmap: true, news: true, earnings: true,
    calendar: true, indices: true, chart: true,
  },
};

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { saved = {}; }
  const s = structuredClone(DEFAULTS);
  for (const k of Object.keys(saved)) {
    if (k === 'panels') Object.assign(s.panels, saved.panels);
    else if (k in s) s[k] = saved[k];
  }
  migrateFeeds(s);
  return s;
}

// Google News blocks requests from Cloudflare's network (the data relay), so
// swap the two Google feeds that used to be defaults for working equivalents.
const RETIRED_FEEDS = {
  'https://news.google.com/rss/search?q=%22stock+futures%22+OR+%22S%26P+500%22+OR+Nasdaq+when:1d&hl=en-US&gl=US&ceid=US:en': ['Yahoo: Index Futures', 'Investing Stocks'],
  'https://news.google.com/rss/search?q=Fed+OR+Powell+OR+inflation+OR+tariffs+OR+Treasury+yields+when:1d&hl=en-US&gl=US&ceid=US:en': ['Investing Econ Data'],
};
function migrateFeeds(s) {
  let changed = false;
  if (s.feeds.some(f => f.url in RETIRED_FEEDS)) {
    const have = new Set(s.feeds.map(f => f.url));
    s.feeds = s.feeds.flatMap(f => (RETIRED_FEEDS[f.url] || null)
      ?.map(name => DEFAULTS.feeds.find(d => d.name === name))
      .filter(d => d && !have.has(d.url) && have.add(d.url)) ?? [f]);
    changed = true;
  }
  // one-time additions of new default feeds (not re-added if you delete them)
  const add = [['truth-social', 'Truth Social: Trump']];
  for (const [id, name] of add) {
    if (s.migrations.includes(id)) continue;
    const d = DEFAULTS.feeds.find(f => f.name === name);
    if (d && !s.feeds.some(f => f.url === d.url)) s.feeds.push(structuredClone(d));
    s.migrations = [...s.migrations, id];
    changed = true;
  }
  if (changed) saveSettings(s);
}

export function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; } catch { return false; }
}

export function resetSettings() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  return structuredClone(DEFAULTS);
}

// ---- line-format helpers used by the settings textareas ----

export const fmt = {
  instruments: (a) => a.map(i => [i.label, i.name, i.src, i.tv, i.dp, i.tick].join(' | ')).join('\n'),
  indices: (a) => a.map(i => [i.label, i.src, i.dp].join(' | ')).join('\n'),
  feeds: (a) => a.map(f => `${f.name} | ${f.url}`).join('\n'),
  folders: (a) => a.map(f => `${f.name}: ${f.keys}`).join('\n'),
};

const rows = (txt) => txt.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const cells = (l) => l.split('|').map(c => c.trim());

export const parse = {
  instruments: (txt) => rows(txt).map(l => {
    const [label, name, src, tv, dp, tick] = cells(l);
    return { label, name: name || label, src, tv: tv || '', dp: Number(dp ?? 2) || 0, tick: Number(tick) || 0 };
  }).filter(i => i.label && i.src),
  indices: (txt) => rows(txt).map(l => {
    const [label, src, dp] = cells(l);
    return { label, src, dp: Number(dp ?? 2) || 0 };
  }).filter(i => i.label && i.src),
  feeds: (txt) => rows(txt).map(l => {
    const i = l.indexOf('|');
    return i < 0 ? null : { name: l.slice(0, i).trim(), url: l.slice(i + 1).trim() };
  }).filter(f => f && /^https?:\/\//.test(f.url)),
  folders: (txt) => rows(txt).map(l => {
    const i = l.indexOf(':');
    return i < 0 ? null : { name: l.slice(0, i).trim(), keys: l.slice(i + 1).trim() };
  }).filter(Boolean),
};
