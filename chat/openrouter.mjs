import { factFields } from './facts.mjs';
export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
export const ANSWER_FORMAT = { type: 'json_schema', json_schema: { name: 'property_answer', strict: true, schema: {
  type: 'object', additionalProperties: false, required: ['statements'], properties: {
    statements: { type: 'array', minItems: 1, maxItems: 8, items: {
      type: 'object', additionalProperties: false, required: ['record_id', 'fields'], properties: {
        record_id: { type: 'string' }, fields: { type: 'array', minItems: 1, maxItems: factFields.length, items: { type: 'string', enum: factFields } },
      },
    } },
  },
} } };

export class ChatError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export async function complete(messages, { apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL, responseFormat = ANSWER_FORMAT, conversation = false, fetchImpl = fetch, timeoutMs = 90_000 } = {}) {
  if (!apiKey?.trim()) throw new ChatError('missing_key', 'Set OPENROUTER_API_KEY privately in .env to enable AI answers.');
  if (!(model.endsWith(':free') || model === 'openrouter/free')) throw new ChatError('paid_model_disabled', 'Only free OpenRouter models are enabled.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: attempt === 0 ? messages : [
        ...messages,
        { role: 'system', content: responseFormat !== ANSWER_FORMAT ? 'Return a complete routing decision matching the required schema.' : conversation ? 'Please give a concise plain-text reply to the user.' : 'The previous attempt was incomplete. Return only the required JSON with at most four record and field selections from the supplied evidence. No tools or reasoning. Do not add facts.' },
      ], stream: false, temperature: 0.1, max_tokens: 2400,
        reasoning: { enabled: false },
        ...(conversation ? {} : { response_format: responseFormat }),
        provider: { require_parameters: true, max_price: { prompt: 0, completion: 0 } } }),
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
      const recoverable = !choice || choice.finish_reason === 'length' ||
        (choice.finish_reason === 'stop' && !choice.message?.content?.trim());
      if (attempt === 0 && recoverable && !controller.signal.aborted) continue;
      throw new ChatError('incomplete_response', 'The model returned an empty or incomplete answer. Please try again.');
    }
    return { content: choice.message.content, model: body.model || model, requested_model: model, recovery_attempts: attempt };
    }
  } catch (error) {
    if (error instanceof ChatError) throw error;
    if (controller.signal.aborted) throw new ChatError('timeout', 'The model took too long to respond. Please try again.');
    throw new ChatError('connection', 'Could not read a valid response from OpenRouter. Please try again.');
  } finally { clearTimeout(timer); }
}
