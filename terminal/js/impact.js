// Market-reaction impact engine.
//
// A headline / post / economic release is only HIGH impact if the market
// actually reacted: within `impactWindowMin` minutes of it hitting, at least
// `impactMinFutures` US index futures (ES/NQ/RTY/YM) moved >= `impactFutPct`, or a Mag 10 stock the item is
// about moved >= `impactMagPct`. Important-looking items that didn't move the
// market are LOW. Forex Factory: US red = HIGH, US orange = INTERMEDIATE,
// everything else is hidden unless the futures reacted.

import { yahooBars } from './market.js';
import { pool } from './net.js';

const STEP = 5 * 60e3; // 5-minute bars

// Words that tie a headline to a Mag 10 company (tickers are matched too).
const COMPANY_WORDS = {
  AAPL: 'apple|tim cook|iphone', MSFT: 'microsoft|satya nadella|azure', NVDA: 'nvidia|jensen huang',
  GOOGL: 'alphabet|google|sundar pichai|youtube', GOOG: 'alphabet|google', AMZN: 'amazon|andy jassy|aws',
  META: 'meta platforms|meta|zuckerberg|facebook|instagram', TSLA: 'tesla|elon musk|musk',
  AVGO: 'broadcom|hock tan', ORCL: 'oracle|larry ellison', NFLX: 'netflix', PLTR: 'palantir',
  AMD: 'amd|lisa su', NOW: 'servicenow', CRM: 'salesforce', JPM: 'jpmorgan|jamie dimon', 'BRK-B': 'berkshire|buffett',
};

export const listOf = (s) => String(s || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);

export async function loadReactionData(cfg) {
  const fut = listOf(cfg.impactFutures).map(src => ({ kind: 'fut', src, label: src.replace(/=F$/, '') }));
  const mag = listOf(cfg.mag10).map(src => ({ kind: 'mag', src, label: src }));
  const res = await pool([...fut, ...mag], 4, async (s) => ({ ...s, bars: (await yahooBars(s.src, '5d', '5m')).bars }));
  const series = res.filter(r => r.ok).map(r => r.value);
  if (!series.some(s => s.kind === 'fut')) throw new Error('no futures data for impact measurement');
  return {
    fut: series.filter(s => s.kind === 'fut'),
    mag: series.filter(s => s.kind === 'mag'),
    magRe: Object.fromEntries(series.filter(s => s.kind === 'mag').map(s => {
      const words = [s.label.replace('-', '.'), ...(COMPANY_WORDS[s.label] || '').split('|').filter(Boolean)]
        .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      // tickers/"Meta"/"AMD" must match case-sensitively; company names case-insensitive
      return [s.label, { tick: new RegExp(`(^|[^A-Za-z$])\\$?(${words[0]})\\b`), name: new RegExp(`\\b(${words.slice(1).join('|') || '$^'})\\b`, 'i') }];
    })),
  };
}

// First bar whose period ends after t (binary search).
function barIndex(bars, t) {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].t + STEP <= t) lo = m + 1; else hi = m; }
  return lo;
}

// Largest close-to-reference move (signed %) within the window after t.
export function reaction(bars, t, windowMin, now = Date.now()) {
  const win = windowMin * 60e3;
  if (!bars?.length) return { state: 'nodata' };
  if (t < bars[0].t) return { state: 'old' };
  const i = barIndex(bars, t);
  if (i >= bars.length) return now - t < win + 10 * 60e3 ? { state: 'pending' } : { state: 'closed' };
  const b0 = bars[i];
  if (b0.t > t + 10 * 60e3) return { state: 'closed' }; // no trading when it hit
  const ref = b0.t <= t ? b0.o : bars[i - 1] && t - bars[i - 1].t < 15 * 60e3 ? bars[i - 1].c : b0.o;
  let best = 0;
  for (let j = i; j < bars.length && bars[j].t < t + win; j++) {
    const m = (bars[j].c / ref - 1) * 100;
    if (Math.abs(m) > Math.abs(best)) best = m;
  }
  const done = bars.at(-1).t + STEP >= t + win || now - t > win + 20 * 60e3;
  return { state: done ? 'done' : 'pending', pct: best };
}

function measure(item, rx, cfg, now, { magOnlyIfMentioned = true } = {}) {
  const futMoves = rx.fut.map(s => ({ label: s.label, ...reaction(s.bars, item.t, cfg.impactWindowMin, now) }));
  const text = `${item.title} ${item.desc || ''}`;
  const mentioned = rx.mag.filter(s => !magOnlyIfMentioned || rx.magRe[s.label].tick.test(text) || rx.magRe[s.label].name.test(text));
  const magMoves = mentioned.map(s => ({ label: s.label, ...reaction(s.bars, item.t, cfg.impactWindowMin, now) }));
  // A real market-moving story moves the indices together; one index alone is usually noise.
  const hitsF0 = futMoves.filter(m => m.pct != null && Math.abs(m.pct) >= cfg.impactFutPct);
  const hitsF = hitsF0.length >= Math.min(cfg.impactMinFutures || 1, futMoves.length) ? hitsF0 : [];
  const hitsM = magMoves.filter(m => m.pct != null && Math.abs(m.pct) >= cfg.impactMagPct);
  const priced = futMoves.some(m => m.pct != null);
  const pending = futMoves.some(m => m.state === 'pending');
  const big = (list) => [...list].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return {
    hit: hitsF.length > 0 || hitsM.length > 0,
    moves: [...big(hitsF).slice(0, 2), ...big(hitsM).slice(0, 2)],
    maxFut: big(futMoves.filter(m => m.pct != null))[0] || null,
    mentioned: mentioned.map(s => s.label),
    priced, pending,
    closed: !priced && futMoves.every(m => m.state === 'closed' || m.state === 'old' || m.state === 'nodata'),
  };
}

export const moveText = (moves, windowMin) => moves.length
  ? `${moves.map(m => `${m.label} ${m.pct > 0 ? '+' : ''}${m.pct.toFixed(2)}%`).join(' · ')} in ${windowMin}m` : '';

// Tier a news/feed item: HIGH (moved market) | LOW (important, no move) | PENDING | null.
export function tierNews(item, rx, cfg, now = Date.now()) {
  if (!rx) return { tier: item.important ? 'UNMEASURED' : null };
  const m = measure(item, rx, cfg, now);
  // Only market-relevant stories can be credited with a move; otherwise every
  // unrelated headline published during a selloff would read as HIGH.
  if (!item.important && !m.mentioned.length) return { tier: null, ...m };
  if (m.hit) return { tier: 'HIGH', why: moveText(m.moves, cfg.impactWindowMin), ...m };
  if (!item.important) return { tier: null, ...m };
  if (m.pending) return { tier: 'PENDING', why: 'measuring market reaction…', ...m };
  const why = m.closed ? 'market closed when it hit' : `no notable move${m.maxFut ? ` (max ${m.maxFut.label} ${m.maxFut.pct > 0 ? '+' : ''}${m.maxFut.pct.toFixed(2)}%)` : ''}`;
  return { tier: 'LOW', why, ...m };
}

// Tier a Forex Factory event. Returns null for events that should not be shown.
export function tierEvent(ev, rx, cfg, now = Date.now(), ctx = {}) {
  const us = ev.country === 'USD';
  const released = ev.t <= now;
  const m = rx && released ? measure({ ...ev, desc: '' }, rx, cfg, now, { magOnlyIfMentioned: true }) : null;
  const why = m?.hit ? moveText(m.moves, cfg.impactWindowMin) : m?.pending ? 'measuring market reaction…' : m?.maxFut
    ? `max ${m.maxFut.label} ${m.maxFut.pct > 0 ? '+' : ''}${m.maxFut.pct.toFixed(2)}% in ${cfg.impactWindowMin}m` : '';
  if (us && ev.impact === 'High') return { tier: 'HIGH', why, ...m };
  // A move at the same minute as a US red release belongs to the red release.
  const sharesRedSlot = ctx.redTimes?.some(t => Math.abs(t - ev.t) <= 2 * 60e3);
  if (us && ev.impact === 'Medium') return { tier: m?.hit && !sharesRedSlot ? 'HIGH' : 'INTERMEDIATE', why, ...m };
  if (m?.hit && !sharesRedSlot) return { tier: 'HIGH', why: `moved futures: ${why}`, ...m };
  return null;
}
