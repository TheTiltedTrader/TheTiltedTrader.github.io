// Scheduled catalysts: market-moving earnings (Nasdaq calendar) and
// high-impact economic releases (ForexFactory weekly feed).

import { fetchJSON } from './net.js';
import { etParts } from './market.js';

// Both sources update slowly and ask for light polling — cache 30 min.
const TTL = 30 * 60e3;
async function cachedJSON(key, url) {
  const k = `ttt.cache.${key}`;
  try {
    const c = JSON.parse(localStorage.getItem(k) || 'null');
    if (c && Date.now() - c.t < TTL) return c.v;
  } catch { /* ignore */ }
  const v = await fetchJSON(url, { timeoutMs: 12000 });
  try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch { /* quota */ }
  return v;
}

// --- trading-day helpers (ET calendar dates, weekends skipped) ---
function shiftWeekday(dateStr, dir) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + dir); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
function todayTradingDate() {
  const p = etParts(Date.now());
  const d = new Date(`${p.date}T12:00:00Z`);
  // after 18:00 ET the "trading day" is tomorrow; weekends roll to Monday
  if (p.h >= 18) d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const capNum = (s) => Number(String(s || '').replace(/[^0-9.]/g, '')) || 0;
const timeTag = (t) => t === 'time-pre-market' ? 'BMO' : t === 'time-after-hours' ? 'AMC' : 'TNS';

export async function loadEarnings(cfg) {
  const today = todayTradingDate();
  const prev = shiftWeekday(today, -1);
  const next = shiftWeekday(today, 1);
  const watch = new Set(cfg.earningsWatchlist.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  const minCap = cfg.earningsMinCapB * 1e9;

  // Once a company has reported, Nasdaq resets its timing to "not supplied",
  // so remember the BMO/AMC timing we saw earlier (kept for ~10 days).
  let timing = {};
  try { timing = JSON.parse(localStorage.getItem('ttt.earnTiming') || '{}'); } catch { timing = {}; }

  const fetchDay = async (date) => {
    const j = await cachedJSON(`earn.${date}`, `https://api.nasdaq.com/api/calendar/earnings?date=${date}`);
    return (j?.data?.rows || []).map(r => {
      const key = `${date}|${r.symbol}`;
      let when = timeTag(r.time);
      if (when !== 'TNS') timing[key] = when; else if (timing[key]) when = timing[key];
      return {
        sym: r.symbol, name: r.name, cap: capNum(r.marketCap), when, date,
        eps: r.epsForecast || '—', actual: r.eps || '', surprise: r.surprise || '',
        ests: r.noOfEsts || '', ly: r.lastYearEPS || '—', fq: r.fiscalQuarterEnding || '',
        watch: watch.has(r.symbol),
      };
    });
  };

  const [p, t, n] = await Promise.allSettled([prev, today, next].map(fetchDay));
  const cutoff = shiftWeekday(today, -8);
  for (const k of Object.keys(timing)) if (k.slice(0, 10) < cutoff) delete timing[k];
  try { localStorage.setItem('ttt.earnTiming', JSON.stringify(timing)); } catch { /* quota */ }
  const keep = (rows) => (rows.status === 'fulfilled' ? rows.value : [])
    .filter(r => r.watch || r.cap >= minCap)
    .sort((a, b) => b.cap - a.cap);

  const groups = [
    // AMC, plus reports whose timing Nasdaq no longer shows (BMO ones already reacted yesterday)
    { title: `Reacting today — ${prev} after close`, rows: keep(p).filter(r => r.when !== 'BMO') },
    { title: `Today ${today} — before open`, rows: keep(t).filter(r => r.when !== 'AMC') },
    { title: `Today ${today} — after close`, rows: keep(t).filter(r => r.when === 'AMC') },
    { title: `Next ${next} — before open`, rows: keep(n).filter(r => r.when !== 'AMC') },
  ];
  const ok = [p, t, n].some(x => x.status === 'fulfilled');
  if (!ok) throw new Error(p.reason?.message || 'earnings unavailable');
  return { groups, today };
}

// All of this week's events; which ones are shown is decided by the impact
// rules in impact.js (US red/orange, or anything that moved the futures).
export async function loadCalendar() {
  const rows = await cachedJSON('ffcal', 'https://nfs.faireconomy.media/ff_calendar_thisweek.json');
  return rows
    .filter(r => r.impact !== 'Holiday')
    .map(r => ({ ...r, t: Date.parse(r.date) }))
    .filter(r => r.t)
    .sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- week ahead
// Expected US red/orange events for the next 5 trading days (with day + date).
// Forex Factory only publishes the current week, so days it doesn't cover
// (e.g. next week, seen from a weekend) come from Nasdaq's economic calendar,
// rated with the names Forex Factory normally marks red/orange.

const EST_RATING = [
  // red
  [/^(non-?farm payrolls|nonfarm payrolls)$/i, 'High'], [/^unemployment rate$/i, 'High'],
  [/^average hourly earnings \((mom|m\/m)\)/i, 'High'], [/^(core )?cpi \((mom|yoy)\)/i, 'High'],
  [/^(core )?ppi \(mom\)/i, 'High'], [/^core pce price index \((mom|yoy)\)/i, 'High'],
  [/^(core )?retail sales \(mom\)/i, 'High'], [/^gdp \(qoq\)/i, 'High'],
  [/fed interest rate decision|fomc statement|fomc press conference|fomc economic projections/i, 'High'],
  [/fomc meeting minutes/i, 'High'], [/fed chair .*speaks|powell speaks/i, 'High'],
  // orange
  [/^initial jobless claims$/i, 'Medium'], [/^adp nonfarm employment change$/i, 'Medium'],
  [/^jolts job openings$/i, 'Medium'], [/^cb consumer confidence$/i, 'Medium'],
  [/^ism (manufacturing|non-manufacturing|services) pmi$/i, 'Medium'],
  [/michigan consumer sentiment|uom consumer sentiment/i, 'Medium'],
  [/^durable goods orders \(mom\)$/i, 'Medium'], [/^(ny )?empire state manufacturing index$/i, 'Medium'],
  [/^philadelphia fed manufacturing index$/i, 'Medium'], [/^pce price index \((mom|yoy)\)$/i, 'Medium'],
  [/^(fomc member|fed) .*speaks$/i, 'Medium'], [/^(president )?trump speaks$/i, 'Medium'],
];
const estRating = (name) => EST_RATING.find(([re]) => re.test(name))?.[1] || null;

const decode = (s) => String(s ?? '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();

// "2026-10-06" + "08:30" (Eastern) → epoch ms
function etToMs(date, hhmm) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  const guess = Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00Z`);
  const p = etParts(guess);
  return guess - (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess);
}
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

export function weekAheadDays(now = Date.now()) {
  const p = etParts(now);
  let d = p.date;
  // today counts until the cash close; weekends roll to Monday
  if ([0, 6].includes(weekdayOf(d)) || p.h >= 16) d = shiftWeekday(d, 1);
  const days = [d];
  while (days.length < 5) days.push(shiftWeekday(days.at(-1), 1));
  return days;
}

export async function loadWeekAhead(cfg) {
  const days = weekAheadDays();
  const ff = await cachedJSON('ffcal', 'https://nfs.faireconomy.media/ff_calendar_thisweek.json').catch(() => []);
  const ffRows = ff.map(r => ({ ...r, t: Date.parse(r.date) })).filter(r => r.t);
  const ffDates = ffRows.map(r => etParts(r.t).date).sort();
  const covered = (date) => ffDates.length && date >= ffDates[0] && date <= ffDates.at(-1);

  const byDay = Object.fromEntries(days.map(d => [d, { date: d, events: [], earnings: [], source: covered(d) ? 'ff' : 'nasdaq' }]));
  for (const r of ffRows) {
    const d = etParts(r.t).date;
    if (!byDay[d] || r.country !== 'USD') continue;
    if (r.impact === 'High' || r.impact === 'Medium' || r.impact === 'Holiday') {
      byDay[d].events.push({ t: r.t, title: r.title, impact: r.impact, forecast: r.forecast, previous: r.previous, est: false });
    }
  }

  // Nasdaq for the uncovered days. Its ?date= returns the PREVIOUS day's events
  // (verified Oct 2026), so query day+1 and calibrate on Initial Jobless Claims (a Thursday).
  const need = days.filter(d => !covered(d));
  let nasdaqErr = null;
  if (need.length) {
    const queries = [...new Set(need.flatMap(d => [d, calDay(d, 1)]))];
    const res = await Promise.allSettled(queries.map(q =>
      cachedJSON(`econ.${q}`, `https://api.nasdaq.com/api/calendar/economicevents?date=${q}`)
        .then(j => ({ q, rows: (j?.data?.rows || []).filter(r => r.country === 'United States') }))));
    const got = res.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!got.length) nasdaqErr = res[0]?.reason?.message || 'Nasdaq calendar unavailable';
    const claims = got.find(g => g.rows.some(r => /^initial jobless claims$/i.test(decode(r.eventName))));
    const shift = claims && weekdayOf(claims.q) === 4 ? 0 : 1; // found on Thursday → no shift
    for (const g of got) {
      const d = shift ? calDay(g.q, -1) : g.q;
      if (!byDay[d] || byDay[d].source !== 'nasdaq') continue;
      for (const r of g.rows) {
        const name = decode(r.eventName), impact = estRating(name);
        if (!impact) continue;
        byDay[d].events.push({ t: etToMs(d, r.gmt), title: name, impact, forecast: decode(r.consensus), previous: decode(r.previous), est: true });
      }
    }
  }

  // Mag 10 (and $300B+) earnings in the window
  const mag = new Set(String(cfg.mag10 || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
  await Promise.allSettled(days.map(async d => {
    const j = await cachedJSON(`earn.${d}`, `https://api.nasdaq.com/api/calendar/earnings?date=${d}`);
    byDay[d].earnings = (j?.data?.rows || [])
      .filter(r => mag.has(r.symbol) || capNum(r.marketCap) >= 300e9)
      .map(r => `${r.symbol} (${timeTag(r.time)})`);
  }));

  for (const d of days) {
    const seen = new Set();
    byDay[d].events = byDay[d].events
      .sort((a, b) => a.t - b.t || (a.impact === 'High' ? -1 : 1))
      .filter(e => !seen.has(e.title) && seen.add(e.title));
  }
  return { days: days.map(d => byDay[d]), nasdaqErr };
}

// Calendar-day shift (Nasdaq's off-by-one is in calendar days: Friday's events sit under Saturday).
function calDay(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
