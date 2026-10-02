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

const IMPACT_RANK = { Low: 1, Medium: 2, High: 3, Holiday: 0 };

export async function loadCalendar(cfg) {
  const rows = await cachedJSON('ffcal', 'https://nfs.faireconomy.media/ff_calendar_thisweek.json');
  const cur = cfg.calendarCurrencies.toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  const min = IMPACT_RANK[cfg.calendarMinImpact] ?? 3;
  return rows
    .filter(r => (cur.includes('ALL') || cur.includes(r.country)) && (IMPACT_RANK[r.impact] ?? 0) >= min)
    .map(r => ({ ...r, t: Date.parse(r.date) }))
    .sort((a, b) => a.t - b.t);
}
