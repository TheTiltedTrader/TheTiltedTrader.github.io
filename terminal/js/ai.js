// Optional AI brief. Uses YOUR Anthropic API key, stored only in this
// browser's localStorage and sent only to api.anthropic.com.

// The SDK is vendored (vendor/anthropic-sdk.js → window.AnthropicSDK) because
// loading it from a CDN fails when the page is opened from a local file.
let sdk;
let fallbackRejected = false; // account/model refused the fallback beta once → stop sending it
async function client(key) {
  sdk ||= window.AnthropicSDK;
  if (!sdk) {
    try { sdk = (await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm')).default; }
    catch { throw new Error('the Anthropic library is missing from this page and could not be loaded from cdn.jsdelivr.net.'); }
  }
  return new sdk({ apiKey: key, dangerouslyAllowBrowser: true });
}

const SYSTEM = `You are the desk strategist for an intraday US index-futures trader (ES, NQ, RTY; also watches CL, GC, SI, BTC).
Write a brief from the data provided. Use only that data; never invent prices, levels, events or quotes.
Impact tags in the data are measured from actual market reactions: only items tagged HIGH moved US index futures or a Mag 10 stock. Treat LOW items as background, and say so if nothing was HIGH.

If the market is OPEN or in pre-market, format (plain text, short lines, no tables):
BIAS: one line (risk-on/off/mixed + why).
WHAT MOVED: 3-5 bullets on the HIGH-impact items and how the futures reacted.
FUTURES: one line per instrument: trend over the 4h/8h windows and the key levels (ON high/low, prior-day high/low, VWAP).
CATALYSTS: scheduled US data, Fed speakers and earnings still ahead, with ET times.
PLAYBOOK: 2-4 if/then scenarios using the levels above.

If the market is CLOSED (weekend, holiday, or the daily halt), write a recap instead — there is always something to say:
LAST SESSION: how the futures finished (day and 5-day change, where they closed vs key levels).
WHAT MOVED THIS WEEK: the HIGH-impact items of the past few days and the reactions.
SINCE THE CLOSE: anything important that hit while closed (it is unpriced: say what could matter at the reopen).
AHEAD: scheduled US red/orange events and earnings still to come this week, if listed.
PREP: 2-3 bullets on levels and scenarios for the reopen.

Keep it under 350 words.`;

function friendly(e) {
  const status = e?.status;
  const msg = e?.error?.error?.message || e?.message || String(e);
  if (status === 401) return 'your Anthropic API key was rejected. Check it in Settings (S).';
  if (status === 403) return `the API refused the request (${msg}).`;
  if (status === 429) return 'rate limited by the API. Try again in a minute.';
  if (/credit balance/i.test(msg)) return 'your Anthropic account has no API credit. Add credit at console.anthropic.com → Billing.';
  if (/Failed to fetch|NetworkError|Connection error/i.test(msg)) return 'could not reach api.anthropic.com (network, firewall or ad blocker).';
  return msg;
}

export async function aiBrief(cfg, context) {
  if (!cfg.anthropicKey) {
    throw new Error('add your Anthropic API key in Settings (S) to enable AI briefs. Get one at console.anthropic.com → API keys (needs API credit; a Claude.ai subscription does not include it).');
  }
  const anthropic = await client(cfg.anthropicKey);
  const base = {
    model: cfg.aiModel || 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{ role: 'user', content: context }],
  };
  let msg;
  try {
    // Server-side fallback re-runs a declined request on another model.
    msg = fallbackRejected
      ? await anthropic.messages.create(base)
      : await anthropic.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    // Some accounts/models reject the fallback beta: retry as a plain request.
    if (!fallbackRejected && e?.status === 400 && /fallback|beta/i.test(e?.error?.error?.message || e?.message || '')) {
      fallbackRejected = true;
      try { msg = await anthropic.messages.create(base); } catch (e2) { throw new Error(friendly(e2)); }
    } else throw new Error(friendly(e));
  }
  if (msg.stop_reason === 'refusal') throw new Error('the model declined this request.');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error('the model returned an empty brief.');
  return text;
}
