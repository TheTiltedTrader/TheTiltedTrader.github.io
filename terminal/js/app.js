import { loadSettings, saveSettings, resetSettings, fmt, parse, DEFAULTS } from './config.js';
import { configureNet, netStats, pool, hasPrivateRoute, routeLabel } from './net.js';
import { loadInstrument, loadQuote, analyze, narrate, riskTone, nf, sgn, etParts, etTime } from './market.js';
import { loadNews, overnightStart } from './news.js';
import { loadEarnings, loadCalendar, loadWeekAhead } from './events.js';
import * as TV from './widgets.js';
import { aiBrief } from './ai.js';
import { loadReactionData, tierNews, tierEvent } from './impact.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => /^https?:\/\//i.test(u) ? u : '#';

let cfg = loadSettings();
configureNet(cfg);

const state = {
  trend: [], trendErr: {}, quotes: [], news: [], newsFailed: [], earnings: null, calendar: [], events: [], rx: null, week: null,
  aiAt: 0, aiErr: '', aiBusy: false,
  selected: 0, newsTab: 'HIGH IMPACT', newsQuery: '', seenLinks: new Set(), ai: '', errors: {},
  updated: {}, busy: false,
};

// ---------------------------------------------------------------- clock & session
function sessionState(now = Date.now()) {
  const p = etParts(now), m = p.h * 60 + p.min, wd = p.wd;
  const weekend = wd === 'Sat' || (wd === 'Sun' && p.h < 18) || (wd === 'Fri' && p.h >= 17);
  if (weekend) return { cls: 'closed', text: 'GLOBEX CLOSED · WEEKEND' };
  if (p.h === 17) return { cls: 'closed', text: 'DAILY HALT · reopens 18:00' };
  if (m >= 570 && m < 960) {
    const left = 960 - m;
    return { cls: 'rth', text: `RTH OPEN · close in ${Math.floor(left / 60)}h${String(left % 60).padStart(2, '0')}` };
  }
  if (m >= 240 && m < 570) {
    const left = 570 - m;
    return { cls: 'globex', text: `PRE-MARKET · cash open in ${Math.floor(left / 60)}h${String(left % 60).padStart(2, '0')}` };
  }
  return { cls: 'globex', text: m >= 960 && m < 1020 ? 'POST-CLOSE · Globex' : 'GLOBEX OVERNIGHT' };
}

function tickClock() {
  const now = Date.now();
  $('#clock').textContent = new Date(now).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }) + ' ET';
  const s = sessionState(now);
  const pill = $('#session');
  pill.className = `pill ${s.cls}`;
  pill.textContent = s.text;
  const nxt = state.events.find(e => e.t > now - 60e3);
  if (nxt) {
    const mins = Math.round((nxt.t - now) / 60e3);
    const when = mins < 0 ? 'NOW' : mins < 90 ? `in ${mins}m` : mins < 48 * 60 ? `in ${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : new Date(nxt.t).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
    $('#nextEvent').textContent = `▲ ${nxt.country} ${nxt.title} ${when}`;
  } else $('#nextEvent').textContent = '';
}

// ---------------------------------------------------------------- helpers
function spark(points, { w = 110, h = 26, base, color } = {}) {
  const ys = points.filter(v => v != null && isFinite(v));
  if (ys.length < 2) return '';
  let min = Math.min(...ys), max = Math.max(...ys);
  if (base != null && isFinite(base)) { min = Math.min(min, base); max = Math.max(max, base); }
  const rng = max - min || 1;
  const X = (i) => (i / (ys.length - 1)) * (w - 2) + 1;
  const Y = (v) => h - 2 - ((v - min) / rng) * (h - 4);
  const d = ys.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const up = ys.at(-1) >= (base ?? ys[0]);
  const c = color || (up ? 'var(--up)' : 'var(--dn)');
  const baseLine = base != null ? `<line x1="0" x2="${w}" y1="${Y(base).toFixed(1)}" y2="${Y(base).toFixed(1)}" stroke="#444" stroke-dasharray="2 2"/>` : '';
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${baseLine}<path d="${d}L${X(ys.length - 1)},${h}L1,${h}Z" fill="${c}" opacity=".12"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.3"/></svg>`;
}
const cls = (x) => x > 0 ? 'up' : x < 0 ? 'dn' : '';
const fmtAgo = (t) => {
  const m = Math.round((Date.now() - t) / 60e3);
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};
function setStatus(text, kind = '') { const el = $('#status'); el.textContent = text; el.className = `status ${kind}`; }

// ---------------------------------------------------------------- loaders
async function refreshTrend() {
  const res = await pool(cfg.instruments, 4, async (inst) => analyze(inst, await loadInstrument(inst), cfg));
  state.trend = []; state.trendErr = {};
  res.forEach((r, i) => r.ok ? state.trend.push(r.value) : (state.trendErr[cfg.instruments[i].label] = r.error.message));
  state.updated.trend = Date.now();
}
async function refreshQuotes() {
  const res = await pool(cfg.indices, 4, loadQuote);
  state.quotes = res.map((r, i) => r.ok ? r.value : { ...cfg.indices[i], err: r.error.message });
  state.updated.quotes = Date.now();
}
async function refreshNews() {
  const { items, failed } = await loadNews(cfg);
  if (!state.news.length) items.forEach(i => state.seenLinks.add(i.link));
  for (const it of items) it.isNew = !state.seenLinks.has(it.link);
  items.forEach(i => state.seenLinks.add(i.link));
  state.news = items; state.newsFailed = failed; state.updated.news = Date.now();
}
async function refreshEarnings() { state.earnings = await loadEarnings(cfg); state.updated.earnings = Date.now(); }
async function refreshCalendar() { state.calendar = await loadCalendar(); state.updated.calendar = Date.now(); }
async function refreshWeek() { state.week = await loadWeekAhead(cfg); state.updated.week = Date.now(); }
async function refreshImpact() { state.rx = await loadReactionData(cfg); state.updated.impact = Date.now(); }

async function refreshAll() {
  if (state.busy) return;
  state.busy = true;
  $('#btnRefresh').classList.add('spin');
  setStatus('Refreshing…', 'busy');
  const jobs = {
    trend: [refreshTrend, renderTrend],
    quotes: [refreshQuotes, renderIndices],
    news: [refreshNews, renderNews],
    calendar: [refreshCalendar, renderCalendar],
    earnings: [refreshEarnings, renderEarnings],
    impact: [refreshImpact, () => {}],
    week: [refreshWeek, renderWeekAhead],
  };
  await Promise.all(Object.entries(jobs).map(async ([k, [load, render]]) => {
    try { await load(); delete state.errors[k]; }
    catch (e) { state.errors[k] = e.message; console.warn(k, e); }
    if (['news', 'calendar', 'impact'].includes(k)) {
      try { applyImpact(); renderNews(); renderCalendar(k === 'calendar'); } catch (e) { console.error('impact', e); }
    }
    try { render(); } catch (e) { console.error('render', k, e); }
    renderBrief();
    if (k === 'trend' || k === 'quotes') renderTape();
  }));
  state.busy = false;
  $('#btnRefresh').classList.remove('spin');
  const errs = Object.keys(state.errors);
  setStatus(errs.length ? `Updated ${etTime(Date.now())} · issues: ${errs.join(', ')}` : `Updated ${etTime(Date.now())} ET`, errs.length ? 'err' : '');
  renderStatusbar();
  updateConnectButton();
  tickClock();
  maybeAutoAI();
}

// ---------------------------------------------------------------- renderers
function renderTrend() {
  const [w1, w2] = cfg.trendHours;
  const head = `<tr><th>SYM</th><th>LAST</th><th>CHG</th><th>%</th>
    ${cfg.trendHours.map(h => `<th>${h}H</th>`).join('')}
    <th style="text-align:left">REGIME ${cfg.trendHours.map(h => h + 'h').join(' / ')}</th>
    <th>ON H / L</th><th>PD H / L</th><th>VWAP</th><th>${Math.max(...cfg.trendHours)}H</th></tr>`;
  const rows = cfg.instruments.map((inst, idx) => {
    const a = state.trend.find(t => t.inst.label === inst.label);
    if (!a) {
      const err = state.trendErr[inst.label];
      return `<tr class="row" data-i="${idx}"><td class="sym">${esc(inst.label)}</td><td colspan="10" class="${err ? 'dn' : 'skeleton'}" style="text-align:left">${err ? 'data unavailable — ' + esc(err) : 'loading…'}</td></tr>`;
    }
    const dp = inst.dp;
    const winCells = cfg.trendHours.map(h => {
      const w = a.windows[h];
      return w ? `<td class="${cls(w.net)}">${sgn(w.pct)}%</td>` : '<td>—</td>';
    }).join('');
    const regime = cfg.trendHours.map(h => {
      const w = a.windows[h];
      return w ? `<span class="tag ${w.tone}" title="ER ${w.er.toFixed(2)} · ${esc(w.structure)}">${w.regime}</span>` : '';
    }).join(' ');
    const lvl = (hi, lo) => {
      if (hi == null) return '—';
      const brk = a.last > hi ? ' brk' : a.last < lo ? ' brk' : '';
      return `<span class="lvl${brk}"><b>${nf(hi, dp)}</b> / <b>${nf(lo, dp)}</b></span>`;
    };
    const vw = a.vwap ? `<span class="${a.last >= a.vwap ? 'up' : 'dn'}">${nf(a.vwap, dp)}</span>` : '—';
    return `<tr class="row ${idx === state.selected ? 'sel' : ''}" data-i="${idx}" title="${esc(inst.name)}">
      <td class="sym">${esc(inst.label)}<small>${idx + 1}</small></td>
      <td class="last ${a.stale ? 'stale' : ''}" title="as of ${etTime(a.lastT)} ET">${nf(a.last, dp)}</td>
      <td class="${cls(a.chg)}">${sgn(a.chg, dp)}</td>
      <td class="${cls(a.pct)}">${sgn(a.pct)}%</td>
      ${winCells}
      <td style="text-align:left">${regime}</td>
      <td>${lvl(a.onh, a.onl)}</td>
      <td>${lvl(a.pdh, a.pdl)}</td>
      <td>${vw}</td>
      <td>${spark(a.spark.map(b => b.c), { base: a.priorClose })}</td>
    </tr>`;
  }).join('');
  $('#trendTable').innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
  const allFailed = cfg.instruments.some(i => state.trendErr[i.label]) && Object.keys(state.trendErr).length >= cfg.instruments.length - 1;
  $('#trendHelp').innerHTML = allFailed ? connectionHelp() : '';
  $('#trendSub').textContent = state.updated.trend ? `5m bars · upd ${etTime(state.updated.trend)}` : '';
  $('#trendWindows').innerHTML = [[4, 8], [2, 6], [4, 12], [8, 24]].map(([a, b]) =>
    `<button class="mini ${a === w1 && b === w2 ? 'on' : ''}" data-win="${a},${b}">${a}/${b}H</button>`).join('');
  renderTrendDetail();
}

function renderTrendDetail() {
  const inst = cfg.instruments[state.selected];
  const a = inst && state.trend.find(t => t.inst.label === inst.label);
  if (!a) { $('#trendDetail').innerHTML = '<span class="dim">Select an instrument (click a row or press 1–9).</span>'; return; }
  const dp = inst.dp;
  const lines = narrate(a).map(l => `<p>${esc(l)}</p>`).join('');
  const w = a.windows[Math.max(...cfg.trendHours)];
  const rangeBar = w ? `<span class="rangebar" title="position in ${Math.max(...cfg.trendHours)}h range"><i style="left:calc(${(w.pos * 100).toFixed(0)}% - 1px)"></i></span>` : '';
  $('#trendDetail').innerHTML = `<h4>${esc(inst.label)} · ${esc(inst.name)} · ${nf(a.last, dp)} <span class="${cls(a.chg)}">${sgn(a.chg, dp)} (${sgn(a.pct)}%)</span> ${rangeBar}
    <span class="dim" style="font-weight:400"> vs prior settle ${nf(a.priorClose, dp)}${a.stale ? ' · market closed / stale' : ''}</span></h4>${lines}`;
}

function renderIndices() {
  $('#indices').innerHTML = `<div class="tiles">${state.quotes.map(q => q.err
    ? `<div class="tile"><div class="l">${esc(q.label)}</div><div class="dn" style="font-size:11px">unavailable</div></div>`
    : `<div class="tile"><div class="l"><span>${esc(q.label)}</span><span class="dim" style="font-weight:400">${q.t ? etTime(q.t) : ''}</span></div>
        <div class="v">${nf(q.last, q.dp)}</div>
        <div class="c ${cls(q.chg)}">${sgn(q.chg, q.dp)} (${sgn(q.pct)}%)</div>
        ${spark(q.closes, { w: 150, h: 22, base: q.prev })}</div>`).join('')}</div>`;
}

// ---------------------------------------------------------------- impact tiers
const TIER_RANK = { HIGH: 4, PENDING: 3, INTERMEDIATE: 2, LOW: 1, UNMEASURED: 1 };
const tierOf = (i) => i.impact?.tier || null;

function applyImpact() {
  const now = Date.now();
  for (const it of state.news) it.impact = tierNews(it, state.rx, cfg, now);
  const redTimes = state.calendar.filter(e => e.country === 'USD' && e.impact === 'High').map(e => e.t);
  state.events = state.calendar
    .map(e => ({ ...e, ffImpact: e.impact, impact: tierEvent(e, state.rx, cfg, now, { redTimes }) }))
    .filter(e => e.impact);
}

// Released Forex Factory events, shaped like news items.
function eventItems() {
  const now = Date.now();
  return state.events.filter(e => e.t <= now).map(e => ({
    kind: 'event', t: e.t, title: `${e.country} ${e.title}`, src: 'Forex Factory',
    link: 'https://www.forexfactory.com/calendar', tags: [], desc: '', score: 5, ev: e, impact: e.impact,
  }));
}
const allItems = () => [...state.news, ...eventItems()].sort((a, b) => b.t - a.t);

function tierTag(i) {
  const t = tierOf(i), why = i.impact?.why ? ` · ${esc(i.impact.why)}` : '';
  if (t === 'HIGH') return `<span class="flag">■ HIGH IMPACT${why}</span>`;
  if (t === 'INTERMEDIATE') return `<span class="flag mid">◆ INTERMEDIATE${why}</span>`;
  if (t === 'PENDING') return `<span class="flag pend">◌ MEASURING${why ? '' : ''}</span>`;
  if (t === 'LOW') return `<span class="flag low">▽ LOW${why}</span>`;
  if (t === 'UNMEASURED') return `<span class="flag low">▽ LOW · reaction data unavailable</span>`;
  return '';
}

const NEWS_TABS = ['HIGH IMPACT', 'INTERMEDIATE', 'LOW IMPACT', 'OVERNIGHT', 'ALL'];

function newsFilterItems() {
  const tab = state.newsTab, q = state.newsQuery.toLowerCase();
  const since = overnightStart(cfg);
  let list = allItems();
  if (tab === 'HIGH IMPACT') list = list.filter(i => ['HIGH', 'PENDING'].includes(tierOf(i)));
  else if (tab === 'INTERMEDIATE') list = list.filter(i => tierOf(i) === 'INTERMEDIATE');
  else if (tab === 'LOW IMPACT') list = list.filter(i => ['LOW', 'UNMEASURED'].includes(tierOf(i)));
  else if (tab === 'OVERNIGHT') list = list.filter(i => i.t >= since).sort((a, b) => (TIER_RANK[tierOf(b)] || 0) - (TIER_RANK[tierOf(a)] || 0) || b.score - a.score);
  else if (tab !== 'ALL' && tab !== 'TV LIVE') list = list.filter(i => i.tags.includes(tab));
  if (q) list = list.filter(i => `${i.title} ${i.src} ${i.tags.join(' ')}`.toLowerCase().includes(q));
  return list.slice(0, 200);
}

function renderNews() {
  const since = overnightStart(cfg);
  const items = allItems();
  const tabs = [...NEWS_TABS, ...cfg.folders.map(f => f.name), 'TV LIVE'];
  const count = (t) => ({
    'ALL': items.length,
    'HIGH IMPACT': items.filter(i => tierOf(i) === 'HIGH').length,
    'INTERMEDIATE': items.filter(i => tierOf(i) === 'INTERMEDIATE').length,
    'LOW IMPACT': items.filter(i => ['LOW', 'UNMEASURED'].includes(tierOf(i))).length,
    'OVERNIGHT': items.filter(i => i.t >= since).length,
    'TV LIVE': '',
  })[t] ?? state.news.filter(i => i.tags.includes(t)).length;
  $('#newsTabs').innerHTML = tabs.map(t => `<button data-tab="${esc(t)}" class="${t === state.newsTab ? 'on' : ''}">${esc(t)}<span class="n">${count(t)}</span></button>`).join('');
  const tv = state.newsTab === 'TV LIVE';
  $('#newsList').classList.toggle('hidden', tv);
  $('#newsTV').classList.toggle('hidden', !tv);
  if (tv) { if (!$('#newsTV').children.length) TV.newsTimeline($('#newsTV')); return; }

  const today = etParts(Date.now()).date;
  const list = newsFilterItems();
  const emptyMsg = state.newsTab === 'HIGH IMPACT'
    ? `Nothing qualifies yet: no story or data release has moved ${cfg.impactMinFutures}+ US index futures ≥ ${cfg.impactFutPct}% or a Mag 10 stock it names ≥ ${cfg.impactMagPct}% within ${cfg.impactWindowMin} minutes. Check LOW IMPACT for important stories without a market reaction.`
    : 'No headlines match.';
  $('#newsList').innerHTML = list.length ? list.map(i => {
    const d = etParts(i.t).date;
    const title = i.title.length > 300 ? i.title.slice(0, 297) + '…' : i.title;
    const evInfo = i.ev ? `<span>${i.ev.ffImpact === 'High' ? 'red' : i.ev.ffImpact === 'Medium' ? 'orange' : 'yellow'} folder · fcst ${esc(i.ev.forecast || 'n/a')} · prev ${esc(i.ev.previous || 'n/a')}</span>` : '';
    return `<div class="news-item ${tierOf(i) === 'HIGH' ? 'hi' : ''} ${i.isNew ? 'new' : ''}">
      <div class="t">${etTime(i.t)}${d !== today ? `<span class="d">${new Date(i.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}</span>` : ''}</div>
      <div><a class="h" href="${esc(safeUrl(i.link))}" target="_blank" rel="noopener noreferrer">${i.kind === 'event' ? '📅 ' : ''}${esc(title)}</a>
      <div class="meta">${tierTag(i)}<span class="src">${esc(i.src)}</span>${evInfo}
        ${i.tags.map(t => `<span class="ft">#${esc(t)}</span>`).join('')}${i.dupes ? `<span>+${i.dupes} sources</span>` : ''}<span>${fmtAgo(i.t)} ago</span></div></div>
    </div>`;
  }).join('') : `<div class="msg ${state.errors.news ? 'err' : ''}">${state.errors.news ? 'News unavailable — ' + esc(state.errors.news) : state.updated.news ? esc(emptyMsg) : '<span class="skeleton">loading feeds…</span>'}</div>`;
  $('#newsSub').textContent = state.updated.news
    ? `${state.news.length} stories · ${cfg.feeds.length - state.newsFailed.length}/${cfg.feeds.length} feeds${state.rx ? '' : ' · reaction data loading'}`
    : '';
}

function renderEarnings() {
  const e = state.earnings;
  if (!e) {
    $('#earnings').innerHTML = `<div class="msg ${state.errors.earnings ? 'err' : ''}">${state.errors.earnings
      ? `Earnings unavailable — ${esc(state.errors.earnings)}.<br>Nasdaq blocks most public proxies; deploy the free proxy in <code>terminal/proxy</code> for reliable data.`
      : '<span class="skeleton">loading…</span>'}</div>`;
    return;
  }
  const capFmt = (c) => c >= 1e12 ? `$${(c / 1e12).toFixed(2)}T` : c ? `$${(c / 1e9).toFixed(0)}B` : '—';
  $('#earnSub').textContent = `≥ $${cfg.earningsMinCapB}B or watchlist`;
  $('#earnings').innerHTML = e.groups.map(g => `<div class="egroup"><h5>${esc(g.title)}</h5>${g.rows.length
    ? `<table class="tbl"><thead><tr><th>SYM</th><th style="text-align:left">COMPANY</th><th>MKT CAP</th><th>EPS EST</th><th>ACTUAL</th><th>SURPR</th><th>FQ</th></tr></thead><tbody>${g.rows.map(r =>
      `<tr><td class="sym">${r.watch ? '<span class="star">★</span>' : ''}<a href="https://www.tradingview.com/symbols/${esc(r.sym)}/" target="_blank" rel="noopener">${esc(r.sym)}</a></td>
        <td style="text-align:left;max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</td>
        <td>${capFmt(r.cap)}</td><td>${esc(r.eps)}</td><td>${r.actual ? esc(r.actual) : `<span class="dim" title="last year">${esc(r.ly)} LY</span>`}</td>
        <td class="${cls(parseFloat(r.surprise))}">${r.surprise ? sgn(parseFloat(r.surprise), 1) + '%' : '—'}</td><td class="dim">${esc(r.fq)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="none">No market-moving reports.</div>'}</div>`).join('');
}

function renderCalendar(autoScroll = true) {
  const now = Date.now();
  const today = etParts(now).date;
  $('#calSub').textContent = `US only · red = high · orange = intermediate · others only if futures moved ≥ ${cfg.impactFutPct}% · ET`;
  if (!state.events.length) {
    $('#calendar').innerHTML = `<div class="msg ${state.errors.calendar ? 'err' : ''}">${state.errors.calendar ? 'Calendar unavailable — ' + esc(state.errors.calendar) + ' (TradingView tab still works).' : state.updated.calendar ? 'No US red/orange events this week.' : '<span class="skeleton">loading…</span>'}</div>`;
    return;
  }
  $('#calendar').innerHTML = `<table class="tbl"><thead><tr><th>DAY</th><th>TIME</th><th style="text-align:left">EVENT</th><th>IMPACT</th><th>FCST</th><th>PREV</th><th style="text-align:left">REACTION</th><th>IN</th></tr></thead><tbody>${state.events.map(e => {
    const p = etParts(e.t);
    const mins = Math.round((e.t - now) / 60e3);
    const rowCls = [mins < -5 ? 'past' : '', mins >= -5 && mins < 120 ? 'soon' : '', p.date === today ? 'today' : ''].join(' ');
    const until = mins < -5 ? 'done' : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${Math.floor(mins / 1440)}d`;
    const tier = e.impact.tier;
    const tierCell = tier === 'HIGH' ? '<span class="tier hi">HIGH</span>' : '<span class="tier mid">INTERM.</span>';
    const react = e.t > now ? '' : e.impact.hit ? `<span class="${cls(e.impact.moves[0]?.pct)}">${esc(e.impact.why.replace(/^moved futures: /, ''))}</span>` : esc(e.impact.why || '');
    return `<tr class="cal-row ${rowCls}"><td>${p.wd}</td><td>${etTime(e.t)}</td>
      <td style="text-align:left"><span class="impact ${esc(e.ffImpact)}"></span>${esc(e.country)} ${esc(e.title)}</td>
      <td>${tierCell}</td><td>${esc(e.forecast || '—')}</td><td class="dim">${esc(e.previous || '—')}</td><td style="text-align:left" class="dim">${react}</td><td>${until}</td></tr>`;
  }).join('')}</tbody></table>`;
  const firstUp = $('#calendar .cal-row:not(.past)');
  if (firstUp && autoScroll) $('#calendar').scrollTop = Math.max(0, firstUp.offsetTop - 40);
}

// ---------------------------------------------------------------- week ahead
const dayLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

function weekCounts(w) {
  const ev = w.days.flatMap(d => d.events);
  return { high: ev.filter(e => e.impact === 'High').length, mid: ev.filter(e => e.impact === 'Medium').length, earn: w.days.reduce((s, d) => s + d.earnings.length, 0) };
}

function renderWeekAhead() {
  const w = state.week, el = $('#weekAhead');
  if (!w) {
    el.innerHTML = `<div class="msg ${state.errors.week ? 'err' : ''}">${state.errors.week ? 'Week ahead unavailable — ' + esc(state.errors.week) : '<span class="skeleton">loading…</span>'}</div>`;
    return;
  }
  const now = Date.now(), today = etParts(now).date;
  const c = weekCounts(w);
  const range = `${dayLabel(w.days[0].date)} – ${dayLabel(w.days.at(-1).date)}`;
  const est = w.days.some(d => d.source === 'nasdaq');
  el.innerHTML = `<div class="wk-sum"><b>${c.high} high-impact</b> · ${c.mid} intermediate US events${c.earn ? ` · ${c.earn} mega-cap earnings` : ''} <span class="dim">· ${range} · times ET</span></div>
    ${w.days.map(d => `<div class="wk-day ${d.date === today ? 'today' : ''}">
      <div class="wk-date">${dayLabel(d.date).toUpperCase()}${d.date === today ? ' · TODAY' : ''}</div>
      <div class="wk-items">${d.events.map(e => e.impact === 'Holiday'
        ? `<div class="wk-ev hol">🏛 ${esc(e.title)} <span class="dim">(US holiday — thin liquidity / early closes possible)</span></div>`
        : `<div class="wk-ev ${e.impact === 'High' ? 'hi' : 'mid'} ${e.t < now - 5 * 60e3 ? 'past' : ''}">
            <span class="impact ${esc(e.impact)}"></span><span class="wk-t">${etTime(e.t)}</span>
            <span class="wk-n">${esc(e.title)}</span>
            <span class="dim">${e.forecast ? `fcst ${esc(e.forecast)} · ` : ''}${e.previous ? `prev ${esc(e.previous)}` : ''}</span>${e.est ? ' <span class="est" title="Rating estimated until Forex Factory publishes this week">est.</span>' : ''}</div>`).join('')
        || '<div class="wk-ev none">No high or intermediate US events</div>'}
        ${d.earnings.length ? `<div class="wk-ev earn">Earnings: ${esc(d.earnings.join(', '))}</div>` : ''}</div>
    </div>`).join('')}
    ${est ? `<p class="hint">"est." = Forex Factory hasn't published that week yet (it does on Sundays); the rating is estimated from the events it usually marks red/orange, using Nasdaq's US calendar.${w.nasdaqErr ? ` Nasdaq: ${esc(w.nasdaqErr)}` : ''}</p>` : ''}`;
}

// Text lines (red-folder only) for the brief and the AI context.
function weekHighLines() {
  if (!state.week) return [];
  return state.week.days.map(d => {
    const hi = d.events.filter(e => e.impact === 'High' || e.impact === 'Holiday');
    const parts = [...hi.map(e => e.impact === 'Holiday' ? `${e.title} (holiday)` : `${etTime(e.t)} ${e.title}${e.forecast ? ` (fcst ${e.forecast}, prev ${e.previous || 'n/a'})` : ''}${e.est ? ' [est.]' : ''}`),
      ...(d.earnings.length ? [`earnings ${d.earnings.join(', ')}`] : [])];
    return parts.length ? { date: d.date, text: parts.join(' · ') } : null;
  }).filter(Boolean);
}

// ---------------------------------------------------------------- brief
const fmtWhen = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' });
const byImpact = (a, b) => (TIER_RANK[tierOf(b)] || 0) - (TIER_RANK[tierOf(a)] || 0) || b.score - a.score;

function briefData() {
  const now = Date.now();
  const session = sessionState(now);
  const closed = session.cls === 'closed';
  const since = overnightStart(cfg, now);
  const items = allItems();
  const overnight = items.filter(i => i.t >= since);
  const top = overnight.filter(i => tierOf(i)).sort(byImpact).slice(0, 7);
  const weekHigh = items.filter(i => tierOf(i) === 'HIGH' && i.t >= now - 7 * 86400e3 && i.t < since).slice(0, 8);
  const tone = riskTone(state.trend);
  const themes = cfg.folders.map(f => {
    const list = overnight.filter(i => i.tags.includes(f.name)).sort(byImpact);
    return { name: f.name, items: list, weight: list.reduce((s, i) => s + (TIER_RANK[tierOf(i)] || 0.5), 0) };
  }).filter(t => t.items.length).sort((a, b) => b.weight - a.weight);
  const horizonH = closed ? 72 : 24;
  const events = state.events.filter(e => e.t > now - 30 * 60e3 && e.t - now < horizonH * 3600e3);
  const earn = state.earnings?.groups.filter(g => /Reacting|before open/.test(g.title) && !/^Next/.test(g.title))
    .flatMap(g => g.rows.slice(0, 8).map(r => `${r.sym} (${r.when === 'TNS' ? (r.actual ? 'reported' : 'time n/a') : r.when})`)) || [];
  return { now, session, closed, since, overnight, top, weekHigh, tone, themes, horizonH, events, earn };
}

function futuresLine(a) {
  const dp = a.inst.dp;
  const ws = cfg.trendHours.map(h => a.windows[h] ? `${h}h ${sgn(a.windows[h].pct)}% ${a.windows[h].regime.toLowerCase()}` : '').filter(Boolean).join(' · ');
  let pos = '';
  if (a.onh != null) pos = a.last > a.onh ? '> ONH' : a.last < a.onl ? '< ONL' : 'in ON rng';
  if (a.pdh != null) pos += a.last > a.pdh ? ' · > PDH' : a.last < a.pdl ? ' · < PDL' : '';
  if (a.vwap) pos += a.last >= a.vwap ? ' · > VWAP' : ' · < VWAP';
  return { label: a.inst.label, last: nf(a.last, dp), pct: a.pct, d5: a.chg5d, ws, pos };
}

function aiSection() {
  if (state.aiBusy) return `<h5>AI BRIEF</h5><div class="ai-out dim">Writing the brief…</div>`;
  if (state.aiErr) return `<h5>AI BRIEF</h5><div class="ai-out err">AI brief failed: ${esc(state.aiErr)}</div>${state.ai ? `<div class="ai-out stale">${esc(state.ai)}</div>` : ''}`;
  if (state.ai) {
    const age = Math.round((Date.now() - state.aiAt) / 60e3);
    return `<h5>AI BRIEF · ${etTime(state.aiAt)} ET${age >= 1 ? ` (${age}m ago)` : ''}${cfg.aiAutoMin ? ` · auto every ${cfg.aiAutoMin}m` : ''}</h5><div class="ai-out">${esc(state.ai)}</div>`;
  }
  if (!cfg.anthropicKey) return `<div class="ai-hint">AI brief: add an Anthropic API key in Settings (S) and it will write and refresh a brief automatically.</div>`;
  return '';
}

function itemLine(i) {
  const t = tierOf(i);
  const tag = t === 'HIGH' ? `<span class="tier hi">HIGH</span> ` : t === 'INTERMEDIATE' ? `<span class="tier mid">INT</span> ` : t === 'PENDING' ? `<span class="tier pend">…</span> ` : t ? `<span class="tier low">LOW</span> ` : '';
  const why = t === 'HIGH' && i.impact?.why ? ` <span class="${cls(i.impact.moves?.[0]?.pct)}">(${esc(i.impact.why)})</span>` : '';
  const title = i.title.length > 160 ? i.title.slice(0, 157) + '…' : i.title;
  return `<li>${tag}<span class="dim">${i.t < Date.now() - 20 * 3600e3 ? fmtWhen(i.t) : etTime(i.t)}</span> <a href="${esc(safeUrl(i.link))}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>${why} <span class="dim">— ${esc(i.src)}</span></li>`;
}

function renderBrief() {
  const b = briefData();
  const sinceTxt = fmtWhen(b.since);
  const toneCls = b.tone ? (b.tone.tone.includes('ON') ? 'up' : b.tone.tone.includes('OFF') ? 'dn' : 'accent') : '';
  const fl = state.trend.map(futuresLine);
  const highN = b.overnight.filter(i => tierOf(i) === 'HIGH').length;
  const html = `
    ${aiSection()}
    ${b.closed ? `<div class="closed-note">${esc(b.session.text)} — recap of the last session and news since the close.</div>` : ''}
    <h5>${b.closed ? 'LAST SESSION TONE' : 'TONE'}</h5>
    <div class="toneline ${toneCls}">${b.tone ? `${b.tone.tone} <span class="dim" style="font-weight:400">equity futures avg ${sgn(b.tone.avg)}% vs prior settle</span>` : '<span class="skeleton">waiting for prices…</span>'}</div>
    <h5>FUTURES · ${cfg.trendHours.join('h / ')}h TRENDS · 5-DAY</h5>
    ${fl.map(f => `<div class="fline"><span class="sym">${esc(f.label)}</span> ${f.last} <span class="${cls(f.pct)}">${sgn(f.pct)}%</span> <span class="dim">5d</span> <span class="${cls(f.d5)}">${sgn(f.d5)}%</span> <span class="dim">· ${esc(f.ws)} · ${esc(f.pos)}</span></div>`).join('') || '<div class="dim">—</div>'}
    <h5>${b.closed ? 'SINCE THE CLOSE' : 'OVERNIGHT'} · since ${sinceTxt} ET · ${b.overnight.length} items · ${highN} high-impact</h5>
    <ul>${b.top.map(itemLine).join('') || '<li class="dim">Nothing important since the close yet.</li>'}</ul>
    ${b.weekHigh.length ? `<h5>HIGH-IMPACT EARLIER THIS WEEK</h5><ul>${b.weekHigh.map(itemLine).join('')}</ul>` : ''}
    <h5>THEMES</h5>
    ${b.themes.slice(0, 5).map(t => `<div class="theme"><b>${esc(t.name)}</b> <span class="dim">(${t.items.length})</span> — <span class="dim">${t.items.slice(0, 2).map(i => esc(i.title.slice(0, 140))).join(' · ')}</span></div>`).join('') || '<div class="dim">—</div>'}
    ${b.closed ? '' : `<h5>CATALYSTS · NEXT 24H</h5>
    <ul>${b.events.map(e => `<li><span class="impact ${esc(e.ffImpact)}"></span>${fmtWhen(e.t)} ${esc(e.country)} ${esc(e.title)}${e.forecast ? ` <span class="dim">f ${esc(e.forecast)} / p ${esc(e.previous)}</span>` : ''}</li>`).join('') || `<li class="dim">No US red/orange events in the next ${b.horizonH}h${b.closed ? ' (Forex Factory lists the current week only)' : ''}.</li>`}
    ${b.earn.length ? `<li>Earnings: ${esc(b.earn.join(', '))}</li>` : ''}</ul>`}
    <h5>WEEK AHEAD · HIGH IMPACT (US red folder)${state.week ? ` · ${esc(dayLabel(state.week.days[0].date))} – ${esc(dayLabel(state.week.days.at(-1).date))}` : ''}</h5>
    <ul>${state.week ? (weekHighLines().map(l => `<li><b>${esc(dayLabel(l.date))}</b> — ${esc(l.text)}</li>`).join('') || '<li class="dim">No red-folder US events expected.</li>') : '<li class="skeleton">loading…</li>'}</ul>`;
  $('#brief').innerHTML = `<div class="brief">${html}</div>`;
}

// Plain-text context for the AI brief and the COPY button.
function briefText() {
  const b = briefData();
  const tierTxt = (i) => tierOf(i) ? `[${tierOf(i)}${i.impact?.why ? ': ' + i.impact.why : ''}] ` : '';
  const L = [];
  L.push(`THE TRADING MISFIT — BRIEF DATA — ${new Date(b.now).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
  L.push(`Market status: ${b.closed ? 'CLOSED' : 'OPEN'} (${b.session.text})`);
  L.push(`Impact rules: HIGH = moved ≥${cfg.impactMinFutures} US index futures ≥${cfg.impactFutPct}% or a named Mag 10 stock ≥${cfg.impactMagPct}% within ${cfg.impactWindowMin}m; US red data = HIGH, US orange = INTERMEDIATE; LOW = important but no notable move.`);
  if (b.tone) L.push(`Tone: ${b.tone.tone} (equity futures avg ${sgn(b.tone.avg)}% vs prior settle)`);
  L.push('', 'FUTURES:');
  for (const a of state.trend) {
    L.push(`${a.inst.label} ${nf(a.last, a.inst.dp)} (${sgn(a.pct)}% vs prior settle ${nf(a.priorClose, a.inst.dp)}; 5-day ${sgn(a.chg5d)}%; last bar ${fmtWhen(a.lastT)} ET)`);
    narrate(a).forEach(n => L.push(`   ${n}`));
  }
  L.push('', `${b.closed ? 'SINCE THE CLOSE' : 'OVERNIGHT'} (since ${fmtWhen(b.since)} ET):`);
  b.overnight.filter(i => tierOf(i)).sort(byImpact).slice(0, 30)
    .forEach(i => L.push(`- ${fmtWhen(i.t)} ${tierTxt(i)}[${i.src}] ${i.title.slice(0, 300)}`));
  const earlier = allItems().filter(i => i.t < b.since && i.t >= b.now - 7 * 86400e3);
  L.push('', 'EARLIER THIS WEEK — HIGH IMPACT:');
  earlier.filter(i => tierOf(i) === 'HIGH').slice(0, 15).forEach(i => L.push(`- ${fmtWhen(i.t)} ${tierTxt(i)}[${i.src}] ${i.title.slice(0, 300)}`));
  L.push('', 'EARLIER THIS WEEK — OTHER IMPORTANT (LOW/INTERMEDIATE):');
  earlier.filter(i => ['LOW', 'INTERMEDIATE'].includes(tierOf(i))).sort(byImpact).slice(0, 15).forEach(i => L.push(`- ${fmtWhen(i.t)} ${tierTxt(i)}[${i.src}] ${i.title.slice(0, 200)}`));
  if (state.week) {
    L.push('', `WEEK AHEAD — US EVENTS (${dayLabel(state.week.days[0].date)} to ${dayLabel(state.week.days.at(-1).date)}, ET; [est.] = rating estimated):`);
    for (const d of state.week.days) {
      const ev = d.events.map(e => e.impact === 'Holiday' ? `${e.title} (US holiday)` : `${etTime(e.t)} ${e.title} [${e.impact === 'High' ? 'HIGH' : 'INTERMEDIATE'}${e.est ? ', est.' : ''}]${e.forecast ? ` fcst ${e.forecast}` : ''}${e.previous ? ` prev ${e.previous}` : ''}`);
      L.push(`- ${dayLabel(d.date)}: ${[...ev, ...(d.earnings.length ? [`earnings ${d.earnings.join(', ')}`] : [])].join('; ') || 'nothing major'}`);
    }
  }
  L.push('', 'US ECONOMIC CALENDAR THIS WEEK (ET):');
  state.events.forEach(e => L.push(`- ${fmtWhen(e.t)} ${e.country} ${e.title} [${e.impact.tier}${e.t <= b.now && e.impact.why ? ': ' + e.impact.why : ''}] fcst ${e.forecast || 'n/a'}, prev ${e.previous || 'n/a'}${e.t > b.now ? ' (upcoming)' : ''}`));
  if (state.earnings) state.earnings.groups.forEach(g => g.rows.length && L.push(`- Earnings ${g.title}: ${g.rows.slice(0, 12).map(r => r.sym + (r.surprise ? ` (surprise ${r.surprise}%)` : '')).join(', ')}`));
  return L.join('\n');
}

async function runAI(auto = false) {
  if (state.aiBusy || (auto && !cfg.anthropicKey)) return;
  const btn = $('#btnAI');
  state.aiBusy = true; state.aiErr = '';
  btn.textContent = 'THINKING…'; btn.disabled = true;
  renderBrief();
  try {
    state.ai = await aiBrief(cfg, briefText());
    state.aiAt = Date.now();
  } catch (e) {
    state.aiErr = e.message;
    if (auto) state.aiAt = Date.now(); // don't retry on every refresh
  } finally {
    state.aiBusy = false;
    btn.textContent = 'AI BRIEF'; btn.disabled = false;
    renderBrief();
    $('#brief').scrollTop = 0;
  }
}

// Called after each refresh: keep the AI brief current without spamming the API.
function maybeAutoAI() {
  if (!cfg.anthropicKey || !cfg.aiAutoMin || state.aiBusy || !state.trend.length) return;
  if (Date.now() - state.aiAt >= cfg.aiAutoMin * 60e3) runAI(true);
}

// Scrolling ticker tape built from our own data (always readable, no widget limits).
function renderTape() {
  const items = [
    ...state.trend.map(a => ({ l: a.inst.label, v: nf(a.last, a.inst.dp), c: a.chg, p: a.pct, dp: a.inst.dp })),
    ...state.quotes.filter(q => !q.err && isFinite(q.last)).map(q => ({ l: q.label, v: nf(q.last, q.dp), c: q.chg, p: q.pct, dp: q.dp })),
  ];
  const tape = $('#tape');
  if (!items.length) {
    tape.innerHTML = `<div class="tape-msg">${state.busy ? 'Loading prices…' : 'Prices unavailable — see the message in the trend monitor.'}</div>`;
    return;
  }
  const html = items.map(i => `<span class="tk"><b>${esc(i.l)}</b> ${i.v} <span class="${cls(i.c)}">${i.c > 0 ? '▲' : i.c < 0 ? '▼' : ''} ${sgn(i.c, i.dp)} (${sgn(i.p)}%)</span></span>`).join('');
  tape.innerHTML = `<div class="tape-track" style="animation-duration:${Math.max(30, items.length * 4)}s">${html}${html}</div>`;
}

function connectionHelp() {
  if (hasPrivateRoute()) return '';
  return `<div class="conn-help"><b>No data connection.</b> Browsers can't read Yahoo, Nasdaq or news feeds directly, and the free public relays are not responding.
    <button class="btn warn" type="button" data-connect>SET UP FREE DATA CONNECTION</button> (one-time, about 5 minutes, nothing installed on your PC).</div>`;
}

// ---------------------------------------------------------------- data connection wizard
async function workerSource() {
  if (window.TTT_WORKER_SRC) return window.TTT_WORKER_SRC;
  const r = await fetch('proxy/worker.js');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function openConnect() {
  $('#connectUrl').value = cfg.proxyUrl;
  $('#connectUpdateNote').classList.toggle('hidden', !(hasPrivateRoute() && relayOutdated()));
  $('#connectResult').textContent = ''; $('#connectResult').className = 'dim';
  $('#connect').showModal();
  try { $('#workerCode').value = await workerSource(); }
  catch (e) { $('#workerCode').value = `// Could not load the relay code (${e.message}). Find it in terminal/proxy/worker.js.`; }
}

async function testConnect() {
  const out = $('#connectResult');
  let base = $('#connectUrl').value.trim().replace(/\/+$/, '');
  if (base && !/^https?:\/\//.test(base)) base = `https://${base}`;
  if (!base) { out.className = 'err'; out.textContent = 'Paste your worker address first.'; return; }
  out.className = 'dim'; out.textContent = 'Testing…';
  const probe = 'https://query1.finance.yahoo.com/v8/finance/chart/ES%3DF?interval=5m&range=1d';
  try {
    const r = await fetch(`${base}/?url=${encodeURIComponent(probe)}`, { cache: 'no-store' });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 120)}`);
    const price = JSON.parse(text)?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (!price) throw new Error('the relay answered, but not with market data. Check that the code was pasted in full and deployed.');
    out.className = 'ok'; out.textContent = `Connected. ES ${price}. Loading all data…`;
    setTimeout(() => { $('#connect').close('saved'); applyNewSettings({ ...cfg, proxyUrl: base }); }, 900);
  } catch (e) {
    out.className = 'err';
    out.textContent = /Failed to fetch|NetworkError|Load failed/i.test(e.message)
      ? 'Could not reach that address. Check it ends in .workers.dev, and that you clicked Deploy after pasting the code (a new worker can take a minute to go live).'
      : `Not working yet: ${e.message}`;
  }
}

// Relay deployed before a host was added to its allow-list → offer to update it.
const relayOutdated = () => state.newsFailed.some(f => /Host not allowed/.test(f));
function updateConnectButton() {
  const btn = $('#btnConnect');
  const outdated = hasPrivateRoute() && relayOutdated();
  btn.classList.toggle('hidden', hasPrivateRoute() && !outdated);
  btn.textContent = outdated ? '⚠ UPDATE RELAY' : '⚠ CONNECT DATA';
  btn.title = outdated ? 'Your relay needs the latest code to load some feeds (e.g. Truth Social)' : 'Set up the free data connection';
}

function renderStatusbar() {
  const bits = [
    `Data route: ${routeLabel()}${netStats.lastRoute ? ` (last: ${netStats.lastRoute})` : ''}`,
    `Requests ok ${netStats.ok} / failed ${netStats.fail}`,
  ];
  if (state.newsFailed.length) bits.push(`<span class="err">Feeds down: ${esc(state.newsFailed.join(', '))}</span>`);
  for (const [k, v] of Object.entries(state.errors)) bits.push(`<span class="err">${k}: ${esc(v)}</span>`);
  bits.push('Futures/quotes via Yahoo Finance & Coinbase (may be delayed) · Heat map & chart via TradingView · Calendar via ForexFactory · Earnings via Nasdaq · Not investment advice');
  $('#statusbar').innerHTML = bits.map(b => `<span>${b}</span>`).join('');
}

// ---------------------------------------------------------------- widgets
function selectInstrument(i) {
  if (i < 0 || i >= cfg.instruments.length) return;
  state.selected = i;
  $$('#trendTable tr.row').forEach(r => r.classList.toggle('sel', +r.dataset.i === i));
  renderTrendDetail();
  const inst = cfg.instruments[i];
  if (cfg.panels.chart && inst.tv) {
    TV.chart($('#chart'), inst.tv, cfg);
    $('#chartSym').textContent = `${inst.label} · ${inst.tv}`;
    $$('#chartTabs .mini').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
  }
}

function mountWidgets() {
  renderTape();
  if (cfg.panels.heatmap) TV.heatmap($('#heatmap'), cfg);
  $('#chartTabs').innerHTML = cfg.instruments.map((inst, i) => inst.tv ? `<button class="mini" data-i="${i}">${esc(inst.label)}</button>` : '').join('');
  selectInstrument(state.selected);
  $('#newsTV').innerHTML = '';
  if (!$('#calendarTV').classList.contains('hidden')) TV.econCalendar($('#calendarTV'));
  else $('#calendarTV').innerHTML = '';
}

function applyPanels() {
  $$('[data-panel]').forEach(p => p.classList.toggle('hidden', !cfg.panels[p.dataset.panel]));
}

// ---------------------------------------------------------------- settings
function openSettings() {
  const f = $('#settingsForm');
  f.proxyUrl.value = cfg.proxyUrl;
  f.usePublicProxies.checked = cfg.usePublicProxies;
  f.trendHours.value = cfg.trendHours.join(', ');
  f.overnightStartHourET.value = cfg.overnightStartHourET;
  f.chartInterval.value = cfg.chartInterval;
  f.instruments.value = fmt.instruments(cfg.instruments);
  f.indices.value = fmt.indices(cfg.indices);
  f.feeds.value = fmt.feeds(cfg.feeds);
  f.folders.value = fmt.folders(cfg.folders);
  f.impactKeys.value = cfg.impactKeys;
  f.earningsMinCapB.value = cfg.earningsMinCapB;
  f.earningsWatchlist.value = cfg.earningsWatchlist;
  for (const k of ['impactFutPct', 'impactMinFutures', 'impactMagPct', 'impactWindowMin', 'impactFutures', 'mag10', 'aiAutoMin']) f[k].value = cfg[k];
  f.anthropicKey.value = cfg.anthropicKey;
  f.aiModel.value = cfg.aiModel;
  $('#panelChecks').innerHTML = Object.keys(DEFAULTS.panels).map(k =>
    `<label><input type="checkbox" name="panel_${k}" ${cfg.panels[k] ? 'checked' : ''}> ${k}</label>`).join('');
  $('#settings').showModal();
}

function readSettingsForm() {
  const f = $('#settingsForm');
  const hours = f.trendHours.value.split(/[ ,]+/).map(Number).filter(h => h > 0 && h <= 72).slice(0, 2);
  const next = {
    ...cfg,
    proxyUrl: f.proxyUrl.value.trim(),
    usePublicProxies: f.usePublicProxies.checked,
    trendHours: hours.length === 2 ? hours : DEFAULTS.trendHours,
    overnightStartHourET: Math.min(23, Math.max(0, +f.overnightStartHourET.value || 16)),
    chartInterval: f.chartInterval.value,
    instruments: parse.instruments(f.instruments.value),
    indices: parse.indices(f.indices.value),
    feeds: parse.feeds(f.feeds.value),
    folders: parse.folders(f.folders.value),
    impactKeys: f.impactKeys.value.trim(),
    earningsMinCapB: Math.max(0, +f.earningsMinCapB.value || 0),
    earningsWatchlist: f.earningsWatchlist.value.trim(),
    impactFutPct: Math.max(0.05, +f.impactFutPct.value || DEFAULTS.impactFutPct),
    impactMinFutures: Math.min(4, Math.max(1, Math.round(+f.impactMinFutures.value || DEFAULTS.impactMinFutures))),
    impactMagPct: Math.max(0.05, +f.impactMagPct.value || DEFAULTS.impactMagPct),
    impactWindowMin: Math.min(60, Math.max(5, +f.impactWindowMin.value || DEFAULTS.impactWindowMin)),
    impactFutures: f.impactFutures.value.trim() || DEFAULTS.impactFutures,
    mag10: f.mag10.value.trim() || DEFAULTS.mag10,
    aiAutoMin: Math.max(0, Math.min(240, Math.round(+f.aiAutoMin.value || 0))),
    anthropicKey: f.anthropicKey.value.trim(),
    aiModel: f.aiModel.value.trim() || DEFAULTS.aiModel,
    panels: Object.fromEntries(Object.keys(DEFAULTS.panels).map(k => [k, f[`panel_${k}`].checked])),
  };
  if (!next.instruments.length) next.instruments = DEFAULTS.instruments;
  return next;
}

function applyNewSettings(next) {
  cfg = next;
  saveSettings(cfg);
  configureNet(cfg);
  updateConnectButton();
  state.selected = Math.min(state.selected, cfg.instruments.length - 1);
  state.trend = []; state.aiAt = 0; // keep the last AI brief on screen; regenerate after this refresh
  applyPanels();
  mountWidgets();
  setupAuto();
  refreshAll();
}

// ---------------------------------------------------------------- auto refresh
let autoTimer;
function setupAuto() {
  clearInterval(autoTimer);
  $('#autoRefresh').value = String(cfg.autoRefreshSec);
  if (cfg.autoRefreshSec > 0) autoTimer = setInterval(() => { if (!document.hidden) refreshAll(); }, cfg.autoRefreshSec * 1000);
}

// ---------------------------------------------------------------- events
function bind() {
  $('#btnRefresh').onclick = (e) => { if (e.shiftKey) mountWidgets(); refreshAll(); };
  $('#btnSettings').onclick = openSettings;
  $('#btnHelp').onclick = () => $('#help').showModal();
  $('#btnConnect').onclick = openConnect;
  document.addEventListener('click', (e) => { if (e.target.closest('[data-connect]')) openConnect(); });
  $('#btnTestConnect').onclick = testConnect;
  $('#connectUrl').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); testConnect(); } };
  $('#btnCopyWorker').onclick = async () => {
    try { await navigator.clipboard.writeText($('#workerCode').value); $('#copyWorkerMsg').textContent = 'Copied. Now paste it into the Cloudflare editor.'; }
    catch { $('#workerCode').select(); $('#copyWorkerMsg').textContent = 'Press Ctrl+C to copy the selected code.'; }
  };
  $('#btnAI').onclick = () => runAI(false);
  $('#btnCopyBrief').onclick = async () => {
    const txt = (state.ai ? `AI BRIEF:\n${state.ai}\n\n` : '') + briefText();
    try { await navigator.clipboard.writeText(txt); $('#btnCopyBrief').textContent = 'COPIED'; }
    catch { $('#btnCopyBrief').textContent = 'FAILED'; }
    setTimeout(() => ($('#btnCopyBrief').textContent = 'COPY'), 1500);
  };
  $('#autoRefresh').onchange = (e) => { cfg.autoRefreshSec = +e.target.value; saveSettings(cfg); setupAuto(); };
  $('#heatSrc').value = cfg.heatmapSource;
  $('#heatSrc').onchange = (e) => { cfg.heatmapSource = e.target.value; saveSettings(cfg); TV.heatmap($('#heatmap'), cfg); };

  $('#trendTable').onclick = (e) => { const r = e.target.closest('tr.row'); if (r) selectInstrument(+r.dataset.i); };
  $('#trendWindows').onclick = (e) => {
    const b = e.target.closest('[data-win]'); if (!b) return;
    cfg.trendHours = b.dataset.win.split(',').map(Number); saveSettings(cfg);
    refreshAll();
  };
  $('#chartTabs').onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) selectInstrument(+b.dataset.i); };
  $('#newsTabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) { state.newsTab = b.dataset.tab; renderNews(); } };
  $('#newsSearch').oninput = (e) => { state.newsQuery = e.target.value; renderNews(); };
  $$('[data-cal]').forEach(b => b.onclick = () => {
    const tab = b.dataset.cal, tv = tab === 'tv';
    $$('[data-cal]').forEach(x => x.classList.toggle('on', x === b));
    $('#weekAhead').classList.toggle('hidden', tab !== 'week');
    $('#calendar').classList.toggle('hidden', tab !== 'list');
    $('#calendarTV').classList.toggle('hidden', !tv);
    if (tab === 'list') renderCalendar();
    if (tv && !$('#calendarTV').children.length) TV.econCalendar($('#calendarTV'));
  });

  const dlg = $('#settings');
  dlg.addEventListener('close', () => { if (dlg.returnValue === 'save') applyNewSettings(readSettingsForm()); });
  $('#btnReset').onclick = () => { if (confirm('Reset all settings to defaults?')) { dlg.close(); applyNewSettings(resetSettings()); } };
  $('#btnExport').onclick = () => {
    const blob = new Blob([JSON.stringify({ ...readSettingsForm(), anthropicKey: '' }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'ttt-terminal-settings.json' });
    a.click(); URL.revokeObjectURL(a.href);
  };
  $('#btnImport').onclick = () => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json' });
    inp.onchange = async () => {
      try {
        const data = JSON.parse(await inp.files[0].text());
        const next = { ...structuredClone(DEFAULTS), ...data, panels: { ...DEFAULTS.panels, ...(data.panels || {}) }, anthropicKey: cfg.anthropicKey };
        dlg.close(); applyNewSettings(next);
      } catch (err) { alert(`Import failed: ${err.message}`); }
    };
    inp.click();
  };

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (e.key === 'Escape' && document.activeElement === $('#newsSearch')) {
      $('#newsSearch').value = ''; state.newsQuery = ''; $('#newsSearch').blur(); renderNews(); return;
    }
    if (typing || $('dialog[open]')) return;
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); if (e.shiftKey) mountWidgets(); refreshAll(); }
    else if (e.key === 's') { e.preventDefault(); openSettings(); }
    else if (e.key === '?') $('#help').showModal();
    else if (e.key === '/') { e.preventDefault(); $('#newsSearch').focus(); }
    else if (e.key === 'h') { state.newsTab = 'HIGH IMPACT'; renderNews(); }
    else if (e.key === 'l') { state.newsTab = 'LOW IMPACT'; renderNews(); }
    else if (e.key === 'a') runAI(false);
    else if (/^[1-9]$/.test(e.key)) selectInstrument(+e.key - 1);
  });
}

// ---------------------------------------------------------------- boot
applyPanels();
bind();
mountWidgets();
renderTrend(); renderNews(); renderEarnings(); renderCalendar(); renderIndices(); renderBrief(); renderStatusbar();
tickClock();
setInterval(tickClock, 1000);
setInterval(() => { if (state.calendar.length || state.news.length) { applyImpact(); renderCalendar(false); renderNews(); } }, 60e3);
setupAuto();
updateConnectButton();
refreshAll().then(() => {
  // First run without a data connection: offer the setup once per browser session.
  let shown = false;
  try { shown = sessionStorage.getItem('ttt.connectShown') === '1'; sessionStorage.setItem('ttt.connectShown', '1'); } catch { /* ignore */ }
  if (!hasPrivateRoute() && !shown && state.trend.length < cfg.instruments.length - 1) openConnect();
});
