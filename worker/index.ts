import type { SearchEvent } from '../shared/types';
import { searchInputSchema } from './schema';
import { getSciHubUrl } from '../shared/papers';
import {
  DEFAULT_DECISION_MODEL,
  DEFAULT_MODEL,
  search,
  ServiceError,
  type Env,
} from './search';

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/config' && request.method === 'GET') {
      return json({
        agent: Boolean(env.OPENROUTER_API_KEY),
        model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
        decisionModel: env.JEV_MODEL || DEFAULT_DECISION_MODEL,
        openalexKey: Boolean(env.OPENALEX_API_KEY),
        accessProtected: Boolean(env.LITAGENT_ACCESS_TOKEN),
        sciHubEnabled: env.ENABLE_SCIHUB === 'true',
      });
    }
    if (url.pathname === '/api/paper/scihub') {
      if (env.ENABLE_SCIHUB !== 'true')
        return json({ error: 'Sci-Hub lookups are disabled.' }, 404);
      if (request.method !== 'GET')
        return new Response(null, { status: 405, headers: { Allow: 'GET' } });
      const destination = getSciHubUrl(url.searchParams.get('doi'));
      if (!destination) return json({ error: 'A valid DOI is required.' }, 400);
      return new Response(null, {
        status: 302,
        headers: {
          Location: destination,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      });
    }
    if (url.pathname !== '/api/search')
      return json({ error: 'Endpoint not found.' }, 404);
    if (request.method !== 'POST')
      return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (
      request.headers.get('Origin') &&
      request.headers.get('Origin') !== url.origin
    )
      return json({ error: 'Cross-origin searches are not allowed.' }, 403);
    if (
      env.LITAGENT_ACCESS_TOKEN &&
      request.headers.get('Authorization') !==
        `Bearer ${env.LITAGENT_ACCESS_TOKEN}`
    )
      return json(
        { error: 'Enter the deployment access token to search.' },
        401,
      );
    if (env.SEARCH_RATE_LIMITER) {
      const { success } = await env.SEARCH_RATE_LIMITER.limit({
        key: request.headers.get('CF-Connecting-IP') || 'local',
      });
      if (!success)
        return json(
          { error: 'Too many searches. Please wait a minute and try again.' },
          429,
        );
    }
    if (!request.headers.get('Content-Type')?.includes('application/json'))
      return json({ error: 'Send an application/json request.' }, 415);
    let body: unknown;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'A search request is required.' }, 400);
      let length = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 8192) {
          await reader.cancel();
          return json({ error: 'Search request is too large.' }, 413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: 'Invalid JSON request.' }, 400);
    }
    const input = searchInputSchema.safeParse(body);
    if (!input.success)
      return json(
        { error: 'Use a query of 3–500 characters and valid search options.' },
        400,
      );
    const cancellation = new AbortController();
    const signal = AbortSignal.any([
      request.signal,
      cancellation.signal,
      AbortSignal.timeout(90000),
    ]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const emit = (event: SearchEvent) => {
          if (!cancellation.signal.aborted)
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        void search(input.data, env, emit, signal)
          .then((result) => emit({ type: 'result', result }))
          .catch((error) => {
            emit({
              type: 'error',
              message:
                error instanceof ServiceError
                  ? error.message
                  : 'Search failed. Please try again.',
            });
          })
          .finally(() => {
            if (!cancellation.signal.aborted) controller.close();
          });
      },
      cancel() {
        cancellation.abort();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
};
