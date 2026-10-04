// News: RSS/Atom ingestion, de-duplication, folder classification and
// high-impact scoring. No paid APIs — just public feeds.

import { fetchText, pool } from './net.js';

const isXml = (t) => /<(rss|feed|rdf:RDF)[\s>]/i.test(t.slice(0, 2000));

function textOf(el, sel) {
  const n = el.querySelector(sel);
  return n ? n.textContent.trim() : '';
}

function stripHtml(s) {
  const d = document.createElement('div');
  d.innerHTML = s;
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

export function parseFeed(xml, feedName) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const items = [...doc.querySelectorAll('item, entry')];
  return items.map(it => {
    let title = stripHtml(textOf(it, 'title'));
    let link = textOf(it, 'link');
    if (!link) link = it.querySelector('link')?.getAttribute('href') || '';
    const date = textOf(it, 'pubDate') || textOf(it, 'published') || textOf(it, 'updated') || textOf(it, 'date');
    const t = Date.parse(date) || 0;
    let src = feedName;
    // Google News puts the publisher at the end: "Headline - Reuters"
    const gsrc = textOf(it, 'source');
    if (gsrc) {
      src = gsrc;
      title = title.replace(new RegExp(`\\s+-\\s+${gsrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
    }
    const desc = stripHtml(textOf(it, 'description') || textOf(it, 'summary')).slice(0, 300);
    return { title, link, t, src, feed: feedName, desc };
  }).filter(i => i.title && i.t);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

function keyRegex(list) {
  const words = list.split(',').map(w => w.trim().toLowerCase()).filter(Boolean)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // whole words, allowing simple plurals/tenses ("tariff" → "tariffs", but "war" ≠ "Warner")
  return words.length ? new RegExp(`\\b(${words.join('|')})(?:s|es|ed|ing)?\\b`, 'gi') : null;
}

export function classify(items, cfg, now = Date.now()) {
  const folders = cfg.folders.map(f => ({ name: f.name, re: keyRegex(f.keys) }));
  const impactRe = keyRegex(cfg.impactKeys);
  const tickers = cfg.earningsWatchlist.split(',').map(s => s.trim()).filter(Boolean);
  const tickRe = tickers.length ? new RegExp(`\\b(${tickers.join('|')})\\b`) : null;

  // de-dup (same story across feeds) — keep the earliest, count sources
  const seen = new Map();
  for (const it of items.sort((a, b) => a.t - b.t)) {
    const k = norm(it.title).slice(0, 70);
    if (seen.has(k)) { seen.get(k).dupes++; continue; }
    seen.set(k, { ...it, dupes: 0 });
  }

  const out = [...seen.values()].filter(i => i.t <= now + 5 * 60e3).map(it => {
    let hay = `${it.title} ${it.desc}`;
    // Trump's own posts always contain his name/signature: don't let that alone
    // file every post under Geopolitics.
    if (/^Truth Social/.test(it.feed)) hay = hay.replace(/\b(president\s+)?(donald\s+j\.?\s+)?trump\b|\bwhite house\b/gi, ' ');
    const tags = folders.filter(f => f.re && hay.match(f.re)).map(f => f.name);
    const impactHits = new Set((it.title.match(impactRe) || []).map(x => x.toLowerCase()));
    const ageH = (now - it.t) / 3600e3;
    let score = impactHits.size * 2 + tags.length + it.dupes * 1.5;
    if (tickRe && tickRe.test(it.title)) score += 1;
    if (/^(breaking|urgent|alert)\b/i.test(it.title)) score += 3;
    const voice = /^(Federal Reserve|Truth Social)/.test(it.feed); // Fed / President statements
    if (voice) score += 3;
    score -= Math.min(ageH, 24) * 0.15; // fresher first
    // "important" = worth measuring; the market reaction decides HIGH vs LOW (impact.js)
    const important = (impactHits.size >= 1 && score >= 2.5) || (voice && tags.length > 0);
    return { ...it, tags, score, important };
  });
  return out.sort((a, b) => b.t - a.t);
}

export async function loadNews(cfg) {
  const results = await pool(cfg.feeds, 4, async (f) => {
    const xml = await fetchText(f.url, { validate: isXml, timeoutMs: 10000 });
    return parseFeed(xml, f.name);
  });
  const items = [], failed = [];
  const why = (e) => /unexpected response/.test(e.message) ? 'blocked or not a news feed'
    : e.message.replace(/^[\w.-]+: /, '');
  results.forEach((r, i) => r.ok ? items.push(...r.value) : failed.push(`${cfg.feeds[i].name} (${why(r.error)})`));
  return { items: classify(items, cfg), failed };
}

// Start of the "overnight" window: most recent cash close (16:00 ET) before
// today's open, rolling back over weekends.
export function overnightStart(cfg, now = Date.now()) {
  const etNow = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const offset = now - etNow.getTime(); // ET-wall-clock → real ms
  const d = new Date(etNow);
  d.setHours(cfg.overnightStartHourET, 0, 0, 0);
  // during/after today's close window we still want the prior close until 18:00
  if (etNow.getHours() < 18 || d > etNow) d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.getTime() + offset;
}
