import { loadSettings, saveSettings, resetSettings, fmt, parse, DEFAULTS } from './config.js';
import { configureNet, netStats, pool, hasPrivateRoute, routeLabel } from './net.js';
import { loadInstrument, loadQuote, analyze, narrate, riskTone, nf, sgn, etParts, etTime } from './market.js';
import { loadNews, overnightStart } from './news.js';
import { loadEarnings, loadCalendar } from './events.js';
import * as TV from './widgets.js';
import { aiBrief } from './ai.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => /^https?:\/\//i.test(u) ? u : '#';

let cfg = loadSettings();
configureNet(cfg);

const state = {
  trend: [], trendErr: {}, quotes: [], news: [], newsFailed: [], earnings: null, calendar: [],
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
  const nxt = state.calendar.find(e => e.t > now - 60e3);
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
async function refreshCalendar() { state.calendar = await loadCalendar(cfg); state.updated.calendar = Date.now(); }

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
  };
  await Promise.all(Object.entries(jobs).map(async ([k, [load, render]]) => {
    try { await load(); delete state.errors[k]; }
    catch (e) { state.errors[k] = e.message; console.warn(k, e); }
    try { render(); } catch (e) { console.error('render', k, e); }
    renderBrief();
    if (k === 'trend' || k === 'quotes') renderTape();
  }));
  state.busy = false;
  $('#btnRefresh').classList.remove('spin');
  const errs = Object.keys(state.errors);
  setStatus(errs.length ? `Updated ${etTime(Date.now())} · issues: ${errs.join(', ')}` : `Updated ${etTime(Date.now())} ET`, errs.length ? 'err' : '');
  renderStatusbar();
  tickClock();
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

function newsFilterItems() {
  const tab = state.newsTab, q = state.newsQuery.toLowerCase();
  const since = overnightStart(cfg);
  let list = state.news;
  if (tab === 'HIGH IMPACT') list = list.filter(i => i.high);
  else if (tab === 'OVERNIGHT') list = list.filter(i => i.t >= since).sort((a, b) => b.score - a.score);
  else if (tab !== 'ALL' && tab !== 'TV LIVE') list = list.filter(i => i.tags.includes(tab));
  if (q) list = list.filter(i => `${i.title} ${i.src} ${i.tags.join(' ')}`.toLowerCase().includes(q));
  return list.slice(0, 200);
}

function renderNews() {
  const since = overnightStart(cfg);
  const tabs = ['HIGH IMPACT', 'OVERNIGHT', 'ALL', ...cfg.folders.map(f => f.name), 'TV LIVE'];
  const count = (t) => t === 'ALL' ? state.news.length : t === 'HIGH IMPACT' ? state.news.filter(i => i.high).length
    : t === 'OVERNIGHT' ? state.news.filter(i => i.t >= since).length : t === 'TV LIVE' ? '' : state.news.filter(i => i.tags.includes(t)).length;
  $('#newsTabs').innerHTML = tabs.map(t => `<button data-tab="${esc(t)}" class="${t === state.newsTab ? 'on' : ''}">${esc(t)}<span class="n">${count(t)}</span></button>`).join('');
  const tv = state.newsTab === 'TV LIVE';
  $('#newsList').classList.toggle('hidden', tv);
  $('#newsTV').classList.toggle('hidden', !tv);
  if (tv) { if (!$('#newsTV').children.length) TV.newsTimeline($('#newsTV')); return; }

  const today = etParts(Date.now()).date;
  const items = newsFilterItems();
  $('#newsList').innerHTML = items.length ? items.map(i => {
    const d = etParts(i.t).date;
    return `<div class="news-item ${i.high ? 'hi' : ''} ${i.isNew ? 'new' : ''}">
      <div class="t">${etTime(i.t)}${d !== today ? `<span class="d">${new Date(i.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}</span>` : ''}</div>
      <div><a class="h" href="${esc(safeUrl(i.link))}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>
      <div class="meta">${i.high ? '<span class="flag">■ HIGH IMPACT</span>' : ''}<span class="src">${esc(i.src)}</span>
        ${i.tags.map(t => `<span class="ft">#${esc(t)}</span>`).join('')}${i.dupes ? `<span>+${i.dupes} sources</span>` : ''}<span>${fmtAgo(i.t)} ago</span></div></div>
    </div>`;
  }).join('') : `<div class="msg ${state.errors.news ? 'err' : ''}">${state.errors.news ? 'News unavailable — ' + esc(state.errors.news) : state.updated.news ? 'No headlines match.' : '<span class="skeleton">loading feeds…</span>'}</div>`;
  $('#newsSub').textContent = state.updated.news ? `${state.news.length} stories · ${cfg.feeds.length - state.newsFailed.length}/${cfg.feeds.length} feeds` : '';
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
  $('#calSub').textContent = `${cfg.calendarCurrencies} · ${cfg.calendarMinImpact}+ impact · times ET`;
  if (!state.calendar.length) {
    $('#calendar').innerHTML = `<div class="msg ${state.errors.calendar ? 'err' : ''}">${state.errors.calendar ? 'Calendar unavailable — ' + esc(state.errors.calendar) + ' (TradingView tab still works).' : state.updated.calendar ? 'No events this week at this impact level.' : '<span class="skeleton">loading…</span>'}</div>`;
    return;
  }
  $('#calendar').innerHTML = `<table class="tbl"><thead><tr><th>DAY</th><th>TIME</th><th style="text-align:left">EVENT</th><th>FCST</th><th>PREV</th><th>IN</th></tr></thead><tbody>${state.calendar.map(e => {
    const p = etParts(e.t);
    const mins = Math.round((e.t - now) / 60e3);
    const rowCls = [mins < -5 ? 'past' : '', mins >= -5 && mins < 120 ? 'soon' : '', p.date === today ? 'today' : ''].join(' ');
    const until = mins < -5 ? 'done' : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${Math.floor(mins / 1440)}d`;
    return `<tr class="cal-row ${rowCls}"><td>${p.wd}</td><td>${etTime(e.t)}</td>
      <td style="text-align:left"><span class="impact ${esc(e.impact)}"></span>${esc(e.country)} ${esc(e.title)}</td>
      <td>${esc(e.forecast || '—')}</td><td class="dim">${esc(e.previous || '—')}</td><td>${until}</td></tr>`;
  }).join('')}</tbody></table>`;
  const firstUp = $('#calendar .cal-row:not(.past)');
  if (firstUp && autoScroll) $('#calendar').scrollTop = Math.max(0, firstUp.offsetTop - 40);
}

// ---------------------------------------------------------------- overnight brief
function briefData() {
  const now = Date.now();
  const since = overnightStart(cfg, now);
  const overnight = state.news.filter(i => i.t >= since);
  const tone = riskTone(state.trend);
  const themes = cfg.folders.map(f => {
    const items = overnight.filter(i => i.tags.includes(f.name)).sort((a, b) => b.score - a.score);
    return { name: f.name, items, weight: items.reduce((s, i) => s + Math.max(i.score, 0.5), 0) };
  }).filter(t => t.items.length).sort((a, b) => b.weight - a.weight);
  const top = [...overnight].sort((a, b) => b.score - a.score).slice(0, 6);
  const todayET = etParts(now).date;
  const events = state.calendar.filter(e => etParts(e.t).date === todayET || (e.t > now && e.t - now < 24 * 3600e3));
  const earn = state.earnings?.groups.filter(g => /Reacting|before open/.test(g.title) && !/^Next/.test(g.title))
    .flatMap(g => g.rows.slice(0, 8).map(r => `${r.sym} (${r.when === 'TNS' ? (r.actual ? 'reported' : 'time n/a') : r.when})`)) || [];
  return { since, overnight, tone, themes, top, events, earn };
}

function futuresLine(a) {
  const dp = a.inst.dp;
  const ws = cfg.trendHours.map(h => a.windows[h] ? `${h}h ${sgn(a.windows[h].pct)}% ${a.windows[h].regime.toLowerCase()}` : '').filter(Boolean).join(' · ');
  let pos = '';
  if (a.onh != null) pos = a.last > a.onh ? '> ONH' : a.last < a.onl ? '< ONL' : 'in ON rng';
  if (a.pdh != null) pos += a.last > a.pdh ? ' · > PDH' : a.last < a.pdl ? ' · < PDL' : '';
  if (a.vwap) pos += a.last >= a.vwap ? ' · > VWAP' : ' · < VWAP';
  return { label: a.inst.label, last: nf(a.last, dp), pct: a.pct, ws, pos };
}

function renderBrief() {
  const b = briefData();
  const sinceTxt = new Date(b.since).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' });
  const toneCls = b.tone ? (b.tone.tone.includes('ON') ? 'up' : b.tone.tone.includes('OFF') ? 'dn' : 'amber') : '';
  const fl = state.trend.map(futuresLine);
  const html = `
    ${state.ai ? `<h5>AI BRIEF</h5><div class="ai-out">${esc(state.ai)}</div>` : ''}
    <h5>TONE</h5>
    <div class="toneline ${toneCls}">${b.tone ? `${b.tone.tone} <span class="dim" style="font-weight:400">equity futures avg ${sgn(b.tone.avg)}% vs settle</span>` : '<span class="skeleton">waiting for prices…</span>'}</div>
    <h5>FUTURES · ${cfg.trendHours.join('h / ')}h TRENDS</h5>
    ${fl.map(f => `<div class="fline"><span class="sym">${esc(f.label)}</span> ${f.last} <span class="${cls(f.pct)}">${sgn(f.pct)}%</span> <span class="dim">· ${esc(f.ws)} · ${esc(f.pos)}</span></div>`).join('') || '<div class="dim">—</div>'}
    <h5>OVERNIGHT NEWS · since ${sinceTxt} ET · ${b.overnight.length} stories, ${b.overnight.filter(i => i.high).length} high-impact</h5>
    <ul>${b.top.map(i => `<li><span class="dim">${etTime(i.t)}</span> <a href="${esc(safeUrl(i.link))}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a> <span class="dim">— ${esc(i.src)}</span></li>`).join('') || '<li class="dim">No overnight headlines loaded yet.</li>'}</ul>
    <h5>THEMES</h5>
    ${b.themes.slice(0, 5).map(t => `<div class="theme"><b>${esc(t.name)}</b> <span class="dim">(${t.items.length})</span> — <span class="dim">${t.items.slice(0, 2).map(i => esc(i.title)).join(' · ')}</span></div>`).join('') || '<div class="dim">—</div>'}
    <h5>CATALYSTS · NEXT 24H</h5>
    <ul>${b.events.map(e => `<li><span class="impact ${esc(e.impact)}"></span>${new Date(e.t).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' })} ${esc(e.country)} ${esc(e.title)}${e.forecast ? ` <span class="dim">f ${esc(e.forecast)} / p ${esc(e.previous)}</span>` : ''}</li>`).join('') || '<li class="dim">No high-impact data scheduled.</li>'}
    ${b.earn.length ? `<li>Earnings: ${esc(b.earn.join(', '))}</li>` : ''}</ul>`;
  $('#brief').innerHTML = `<div class="brief">${html}</div>`;
}

function briefText() {
  const b = briefData();
  const L = [];
  L.push(`TTT OVERNIGHT BRIEF — ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`);
  if (b.tone) L.push(`Tone: ${b.tone.tone} (equity futures avg ${sgn(b.tone.avg)}%)`);
  L.push('', 'FUTURES:');
  for (const a of state.trend) {
    L.push(`${a.inst.label} ${nf(a.last, a.inst.dp)} (${sgn(a.pct)}% vs settle ${nf(a.priorClose, a.inst.dp)})`);
    narrate(a).forEach(n => L.push(`   ${n}`));
  }
  L.push('', `OVERNIGHT HEADLINES (since ${new Date(b.since).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET):`);
  [...b.overnight].sort((x, y) => y.score - x.score).slice(0, 25)
    .forEach(i => L.push(`- ${etTime(i.t)} [${i.src}]${i.tags.length ? ' {' + i.tags.join(', ') + '}' : ''} ${i.title}`));
  L.push('', 'SCHEDULED (ET):');
  b.events.forEach(e => L.push(`- ${new Date(e.t).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' })} ${e.country} ${e.title} (impact ${e.impact}; fcst ${e.forecast || 'n/a'}, prev ${e.previous || 'n/a'})`));
  if (state.earnings) state.earnings.groups.forEach(g => g.rows.length && L.push(`- Earnings ${g.title}: ${g.rows.slice(0, 12).map(r => r.sym).join(', ')}`));
  return L.join('\n');
}

async function runAI() {
  const btn = $('#btnAI');
  btn.textContent = 'THINKING…'; btn.disabled = true;
  try {
    state.ai = await aiBrief(cfg, briefText());
  } catch (e) {
    state.ai = `AI brief failed: ${e.message}`;
  } finally {
    btn.textContent = 'AI BRIEF'; btn.disabled = false;
    renderBrief();
    $('#brief').scrollTop = 0;
  }
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
    Close this page and open the terminal with <code>Start-Terminal.bat</code> (in the same folder as this file) — it runs a small helper on your PC that fetches the data.
    Or paste a proxy URL in Settings (S).</div>`;
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
  f.calendarCurrencies.value = cfg.calendarCurrencies;
  f.calendarMinImpact.value = cfg.calendarMinImpact;
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
    calendarCurrencies: f.calendarCurrencies.value.trim() || 'USD',
    calendarMinImpact: f.calendarMinImpact.value,
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
  state.selected = Math.min(state.selected, cfg.instruments.length - 1);
  state.trend = []; state.ai = '';
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
  $('#btnAI').onclick = runAI;
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
    const tv = b.dataset.cal === 'tv';
    $$('[data-cal]').forEach(x => x.classList.toggle('on', x === b));
    $('#calendar').classList.toggle('hidden', tv);
    $('#calendarTV').classList.toggle('hidden', !tv);
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
    else if (e.key === 'a') runAI();
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
setInterval(() => { if (state.calendar.length) renderCalendar(false); }, 60e3);
setupAuto();
refreshAll();
