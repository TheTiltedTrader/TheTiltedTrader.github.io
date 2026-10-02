// Optional AI pre-market brief. Uses YOUR Anthropic API key, stored only in
// this browser's localStorage and sent only to api.anthropic.com.

let sdk;
async function client(key) {
  sdk ||= (await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm')).default;
  return new sdk({ apiKey: key, dangerouslyAllowBrowser: true });
}

const SYSTEM = `You are the morning desk strategist for an intraday index-futures trader (ES, NQ, RTY; also watches CL, GC, SI, BTC).
Write a tight pre-market brief from the data provided. Use only the data given; do not invent prices, levels or events.
Format (plain text, short lines, no tables):
BIAS: one line (risk-on/off/mixed + why).
OVERNIGHT: 3-5 bullets on what moved markets overnight and why it matters for US index futures.
FUTURES: one line per instrument: trend over the 4h/8h windows and the key levels to watch (ON high/low, prior-day high/low, VWAP).
CATALYSTS TODAY: scheduled data/Fed speakers/earnings with ET times.
PLAYBOOK: 2-4 bullets of if/then scenarios using the levels above.
Keep it under 350 words.`;

export async function aiBrief(cfg, context) {
  if (!cfg.anthropicKey) throw new Error('Add your Anthropic API key in Settings (S) to enable AI briefs.');
  const anthropic = await client(cfg.anthropicKey);
  const msg = await anthropic.beta.messages.create({
    model: cfg.aiModel || 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: context }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('The model declined this request.');
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}
