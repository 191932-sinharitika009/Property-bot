export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-super-vl:free';

export class ChatError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export async function complete(messages, { apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  if (!apiKey?.trim()) throw new ChatError('missing_key', 'Set OPENROUTER_API_KEY privately in .env to enable AI answers.');
  if (!(model.endsWith(':free') || model === 'openrouter/free')) throw new ChatError('paid_model_disabled', 'Only free OpenRouter models are enabled.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, temperature: 0.1, max_tokens: 1600,
        provider: { max_price: { prompt: 0, completion: 0 } } }),
    });
    if (!response.ok) {
      const errors = { 401: ['authentication', 'OpenRouter rejected the API key. Check the local configuration.'],
        402: ['quota', 'OpenRouter account quota or credit requirements prevented this request.'],
        429: ['rate_limit', 'The free model is rate limited. Please try again later.'] };
      const [code, message] = errors[response.status] ?? ['provider_unavailable', 'The model provider could not complete this request. Please try again later.'];
      throw new ChatError(code, message);
    }
    const body = await response.json();
    if (body.error) throw new ChatError('provider_unavailable', 'OpenRouter returned a provider error. Please try again later.');
    const choice = body.choices?.[0];
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) {
      throw new ChatError('incomplete_response', 'The model returned an empty or incomplete answer. Please try again.');
    }
    return { content: choice.message.content, model: body.model || model, requested_model: model };
  } catch (error) {
    if (error instanceof ChatError) throw error;
    if (controller.signal.aborted) throw new ChatError('timeout', 'The model took too long to respond. Please try again.');
    throw new ChatError('connection', 'Could not read a valid response from OpenRouter. Please try again.');
  } finally { clearTimeout(timer); }
}
