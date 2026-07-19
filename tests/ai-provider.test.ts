import { describe, expect, it, vi } from 'vitest';
import { AiError, OpenRouterProvider } from '@/lib/ai/provider';

/** Minimal OpenAI-compatible response shape. */
function okResponse(content: string) {
  const body = { choices: [{ message: { role: 'assistant', content } }] };
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeProvider(fetchFn: typeof fetch, model = 'openrouter/free') {
  return new OpenRouterProvider({ apiKey: 'test-key', model, fetchFn });
}

describe('OpenRouterProvider', () => {
  it('posts an OpenAI-compatible chat completion to the right endpoint', async () => {
    const fetchFn = vi.fn(async () => okResponse('Median is $30.00.')) as unknown as typeof fetch;
    const provider = makeProvider(fetchFn);

    const text = await provider.generate({ system: 'SYS', user: 'USR' });

    expect(text).toBe('Median is $30.00.');

    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');

    const req = init as RequestInit;
    expect(req.method).toBe('POST');
    expect(req.headers).toMatchObject({ Authorization: 'Bearer test-key' });

    const body = JSON.parse(req.body as string);
    expect(body.model).toBe('openrouter/free');
    expect(body.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ]);
  });

  it('defaults to the free auto-router rather than a model that may be withdrawn', async () => {
    const fetchFn = vi.fn(async () => okResponse('ok')) as unknown as typeof fetch;
    await makeProvider(fetchFn).generate({ system: 's', user: 'u' });
    const body = JSON.parse(
      ((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit)
        .body as string,
    );
    expect(body.model).toBe('openrouter/free');
  });

  it('reports the provider name for attribution', () => {
    const provider = makeProvider(vi.fn() as unknown as typeof fetch);
    expect(provider.name).toBe('openrouter');
  });

  it('surfaces the upstream error message on a failed request', async () => {
    const fetchFn = vi.fn(async () =>
      errResponse(401, { error: { message: 'No auth credentials found' } }),
    ) as unknown as typeof fetch;

    const err = await makeProvider(fetchFn)
      .generate({ system: 's', user: 'u' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AiError);
    expect(err.status).toBe(401);
    expect(err.provider).toBe('openrouter');
    expect(err.message).toContain('No auth credentials found');
  });

  it('raises rather than returning an empty narrative', async () => {
    const fetchFn = vi.fn(async () => okResponse('   ')) as unknown as typeof fetch;
    await expect(makeProvider(fetchFn).generate({ system: 's', user: 'u' })).rejects.toThrow(
      /empty response/i,
    );
  });

  it('wraps a network failure as AiError', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const err = await makeProvider(fetchFn)
      .generate({ system: 's', user: 'u' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toMatch(/could not reach openrouter/i);
  });

  it('honours a custom base URL and model', async () => {
    const fetchFn = vi.fn(async () => okResponse('ok')) as unknown as typeof fetch;
    const provider = new OpenRouterProvider({
      apiKey: 'k',
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      baseUrl: 'https://proxy.example/v1/',
      fetchFn,
    });

    await provider.generate({ system: 's', user: 'u' });

    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://proxy.example/v1/chat/completions'); // trailing slash trimmed
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('meta-llama/llama-3.3-70b-instruct:free');
  });
});
