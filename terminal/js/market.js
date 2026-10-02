// Price data (Yahoo Finance chart API + Coinbase) and the intraday trend
// analytics behind the Futures Trend Monitor.

import { fetchJSON } from './net.js';

const HOUR = 3600e3;

// ---------- Eastern-time helpers ----------
const etFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
});
export function etParts(ms) {
  const p = Object.fromEntries(etFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, wd: p.weekday, date: `${p.year}-${p.month}-${p.day}` };
}
export const etMinutes = (ms) => { const p = etParts(ms); return p.h * 60 + p.min; };
export function etTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
}
// Futures trade date: a bar at/after the session open (18:00 ET) belongs to the next day.
const sessionKey = (ms, openHour) => etParts(ms + (24 - openHour) * HOUR).date;

// ---------- fetching ----------
async function yahooBars(sym, range = '5d', interval = '5m') {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}&includePrePost=true`;
  let j;
  try { j = await fetchJSON(`https://query1.finance.yahoo.com${path}`); }
  catch { j = await fetchJSON(`https://query2.finance.yahoo.com${path}`); } // Yahoo's backup host
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || `no data for ${sym}`);
  const q = r.indicators?.quote?.[0] || {};
  const bars = [];
  (r.timestamp || []).forEach((t, i) => {
    if (q.close?.[i] == null) return;
    bars.push({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume?.[i] || 0 });
  });
  return { bars, meta: r.meta || {} };
}

async function coinbaseBars(product) {
  const now = Date.now();
  const gran = 300; // 5m, 300 candles per request = 25h
  const span = gran * 300 * 1000;
  const urls = [0, 1].map(k => {
    const end = new Date(now - k * span).toISOString();
    const start = new Date(now - (k + 1) * span).toISOString();
    return `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${gran}&start=${start}&end=${end}`;
  });
  const parts = await Promise.all(urls.map(u => fetchJSON(u, { directFirst: true })));
  const seen = new Set();
  const bars = parts.flat()
    .map(([t, l, h, o, c, v]) => ({ t: t * 1000, o, h, l, c, v }))
    .filter(b => !seen.has(b.t) && seen.add(b.t))
    .sort((a, b) => a.t - b.t);
  return { bars, meta: {} };
}

export async function loadInstrument(inst) {
  if (inst.src.startsWith('coinbase:')) {
    try { return await coinbaseBars(inst.src.slice(9)); }
    catch { return yahooBars('BTC-USD'); }
  }
  return yahooBars(inst.src);
}

export async function loadQuote(ix) {
  const { bars, meta } = await yahooBars(ix.src, '1d', '5m');
  const last = meta.regularMarketPrice ?? bars.at(-1)?.c;
  const prev = meta.previousClose ?? meta.chartPreviousClose;
  return {
    ...ix, last, prev,
    chg: last - prev, pct: prev ? (last / prev - 1) * 100 : NaN,
    hi: meta.regularMarketDayHigh, lo: meta.regularMarketDayLow,
    closes: bars.map(b => b.c), t: (meta.regularMarketTime || 0) * 1000,
  };
}

// ---------- analytics ----------
function hl(bars) {
  let h = -Infinity, l = Infinity;
  for (const b of bars) { if (b.h > h) h = b.h; if (b.l < l) l = b.l; }
  return bars.length ? { h, l } : null;
}

function windowStats(bars, last) {
  if (bars.length < 3) return null;
  const first = bars[0].o ?? bars[0].c;
  const net = last - first;
  let path = 0;
  for (let i = 1; i < bars.length; i++) path += Math.abs(bars[i].c - bars[i - 1].c);
  path += Math.abs(bars[0].c - first);
  const { h, l } = hl(bars);
  const er = path ? Math.abs(net) / path : 0;           // Kaufman efficiency ratio
  const pos = h > l ? (last - l) / (h - l) : 0.5;        // where price sits in the window range
  const avgBar = bars.reduce((s, b) => s + (b.h - b.l), 0) / bars.length;

  // market structure: compare highs/lows of the window's thirds
  const n = Math.floor(bars.length / 3);
  let structure = 'mixed';
  if (n >= 2) {
    const [a, b, c] = [bars.slice(0, n), bars.slice(n, 2 * n), bars.slice(2 * n)].map(hl);
    const hh = b.h > a.h && c.h > b.h, hlw = b.l > a.l && c.l > b.l;
    const lh = b.h < a.h && c.h < b.h, ll = b.l < a.l && c.l < b.l;
    if (hh && hlw) structure = 'HH/HL';
    else if (lh && ll) structure = 'LH/LL';
    else if (hlw && !ll) structure = 'higher lows';
    else if (lh && !hh) structure = 'lower highs';
    else if (c.h <= Math.max(a.h, b.h) && c.l >= Math.min(a.l, b.l)) structure = 'inside / balance';
  }

  const dir = net > 0 ? 'UP' : net < 0 ? 'DOWN' : 'FLAT';
  let regime, tone;
  if (er >= 0.35) { regime = `TREND ${dir}`; tone = dir === 'UP' ? 'up2' : 'dn2'; }
  else if (er >= 0.18) { regime = `DRIFT ${dir}`; tone = dir === 'UP' ? 'up1' : 'dn1'; }
  else { regime = 'RANGE'; tone = 'flat'; }

  let note = '';
  if (net > 0 && pos < 0.35) note = 'faded off highs';
  else if (net < 0 && pos > 0.65) note = 'bounced off lows';
  else if (pos >= 0.9) note = 'pressing window highs';
  else if (pos <= 0.1) note = 'pressing window lows';

  return { net, pct: (net / first) * 100, h, l, er, pos, avgBar, structure, regime, tone, note, from: bars[0].t };
}

export function analyze(inst, data, cfg, now = Date.now()) {
  const { bars, meta } = data;
  if (!bars.length) throw new Error('no bars');
  const lastBar = bars.at(-1);
  const last = (meta.regularMarketPrice && Math.abs(meta.regularMarketTime * 1000 - lastBar.t) < 15 * 60e3)
    ? meta.regularMarketPrice : lastBar.c;
  const openH = cfg.sessionStartHourET;

  // split into futures sessions
  const groups = [];
  for (const b of bars) {
    const k = sessionKey(b.t, openH);
    if (!groups.length || groups.at(-1).k !== k) groups.push({ k, bars: [] });
    groups.at(-1).bars.push(b);
  }
  const cur = groups.at(-1).bars;
  const prior = groups.length > 1 ? groups.at(-2).bars : [];
  const isRth = (b) => { const m = etMinutes(b.t); return m >= 570 && m < 960; }; // 09:30-16:00

  const priorClose = meta.previousClose ?? prior.at(-1)?.c ?? cur[0].o;
  const priorRth = prior.filter(isRth);
  const pd = hl(priorRth.length ? priorRth : prior);
  const pdClose = (priorRth.length ? priorRth : prior).at(-1)?.c;
  const on = hl(cur.filter(b => etMinutes(b.t) < 570 || etMinutes(b.t) >= openH * 60));
  const sess = hl(cur);

  let pv = 0, vol = 0;
  for (const b of cur) { const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vol += b.v; }
  const vwap = vol > 0 ? pv / vol : null;

  const ref = lastBar.t;
  const windows = {};
  for (const h of cfg.trendHours) windows[h] = windowStats(bars.filter(b => b.t > ref - h * HOUR), last);

  const maxH = Math.max(...cfg.trendHours);
  const spark = bars.filter(b => b.t > ref - maxH * HOUR);

  return {
    inst, last, lastT: lastBar.t, stale: now - lastBar.t > 20 * 60e3,
    priorClose, chg: last - priorClose, pct: (last / priorClose - 1) * 100,
    pdh: pd?.h, pdl: pd?.l, pdc: pdClose, onh: on?.h, onl: on?.l, sh: sess?.h, sl: sess?.l,
    vwap, windows, spark,
  };
}

// ---------- formatting / narrative ----------
export const nf = (x, dp = 2) => (x == null || !isFinite(x)) ? '—'
  : x.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const sgn = (x, dp = 2) => (x == null || !isFinite(x)) ? '—' : (x > 0 ? '+' : '') + nf(x, dp);

export function narrate(a) {
  const { inst } = a, dp = inst.dp;
  const ticks = (x) => inst.tick ? ` (${Math.round(x / inst.tick)} ticks)` : '';
  const parts = [];
  for (const [h, w] of Object.entries(a.windows)) {
    if (!w) continue;
    const range = w.h - w.l;
    let s = `${h}h ${sgn(w.net, dp)} (${sgn(w.pct)}%) — ${w.regime.toLowerCase()}, ${w.structure}`;
    s += `; range ${nf(w.l, dp)}–${nf(w.h, dp)} = ${nf(range, dp)}${ticks(range)}, price at ${Math.round(w.pos * 100)}% of range`;
    if (w.note) s += `, ${w.note}`;
    parts.push(s + '.');
  }
  const lv = [];
  if (a.vwap) lv.push(`${a.last >= a.vwap ? 'above' : 'below'} session VWAP ${nf(a.vwap, dp)}`);
  if (a.onh != null) {
    if (a.last > a.onh) lv.push(`ABOVE ON high ${nf(a.onh, dp)}`);
    else if (a.last < a.onl) lv.push(`BELOW ON low ${nf(a.onl, dp)}`);
    else lv.push(`inside ON range ${nf(a.onl, dp)}–${nf(a.onh, dp)}`);
  }
  if (a.pdh != null) {
    if (a.last > a.pdh) lv.push(`above prior-day high ${nf(a.pdh, dp)}`);
    else if (a.last < a.pdl) lv.push(`below prior-day low ${nf(a.pdl, dp)}`);
    else lv.push(`inside prior-day range (PDH ${nf(a.pdh, dp)} / PDL ${nf(a.pdl, dp)})`);
  }
  if (lv.length) parts.push(`Levels: ${lv.join('; ')}.`);
  return parts;
}

// Overall risk tone from equity index futures vs havens.
export function riskTone(list) {
  const by = Object.fromEntries(list.map(a => [a.inst.label, a]));
  const eq = ['ES', 'NQ', 'RTY'].map(k => by[k]?.pct).filter(x => isFinite(x));
  if (!eq.length) return null;
  const avg = eq.reduce((s, x) => s + x, 0) / eq.length;
  const gold = by.GC?.pct;
  let tone = 'MIXED';
  if (avg > 0.25) tone = 'RISK-ON'; else if (avg < -0.25) tone = 'RISK-OFF';
  if (tone === 'MIXED' && avg > 0.05 && !(gold > 0.5)) tone = 'MILD RISK-ON';
  if (tone === 'MIXED' && avg < -0.05) tone = 'MILD RISK-OFF';
  return { tone, avg };
}
