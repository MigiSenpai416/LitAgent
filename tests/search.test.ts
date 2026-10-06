import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import {
  keywordPlan,
  normalizeWork,
  safeUrl,
  search,
  type Env,
} from '../worker/search';
import { searchInputSchema, type Work } from '../worker/schema';
import { streamSearch } from '../src/api';
import type { SearchEvent } from '../shared/types';
import { getSciHubUrl } from '../shared/papers';

const env = { ASSETS: { fetch: vi.fn() } } as unknown as Env;
const input = searchInputSchema.parse({
  query: 'urban green spaces mental health',
});
const plan = {
  question: 'How do urban green spaces affect mental health?',
  concepts: [
    { label: 'Green spaces', description: 'Parks and vegetation in cities' },
    { label: 'Mental health', description: 'Psychological wellbeing' },
  ],
  queries: ['urban green space mental health', 'urban parks wellbeing'],
};

function work(id = 'W1', overrides: Partial<Work> = {}): Work {
  return {
    id: `https://openalex.org/${id}`,
    display_name: 'Urban green spaces and mental wellbeing',
    doi: 'https://doi.org/10.1234/green.1',
    publication_year: 2024,
    cited_by_count: 42,
    authorships: [{ author: { display_name: 'A. Researcher' } }],
    abstract_inverted_index: {
      Green: [0],
      spaces: [1],
      support: [2],
      wellbeing: [3],
    },
    best_oa_location: {
      is_oa: true,
      pdf_url: 'https://repository.example/paper.pdf',
      landing_page_url: 'https://repository.example/paper',
    },
    primary_location: {
      is_oa: false,
      source: { display_name: 'Research Journal' },
    },
    ...overrides,
  };
}

function routerPlan() {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(plan) } }],
  });
}
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://litagent.example/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('paper metadata', () => {
  it('reconstructs abstracts, preserves full titles and DOI, and selects only open-access locations', () => {
    const paper = normalizeWork(work());
    expect(paper.title).toBe('Urban green spaces and mental wellbeing');
    expect(paper.doi).toBe('10.1234/green.1');
    expect(paper.abstract).toBe('Green spaces support wellbeing');
    expect(paper.openAccessUrl).toBe('https://repository.example/paper.pdf');
    expect(paper.venue).toBe('Research Journal');
    expect(paper.score).toBeNull();
  });

  it('handles missing abstracts and DOIs without inventing them', () => {
    const paper = normalizeWork(
      work('W1', {
        doi: null,
        abstract_inverted_index: null,
        best_oa_location: null,
        locations: [
          { is_oa: false, pdf_url: 'https://publisher.example/paywall.pdf' },
        ],
      }),
    );
    expect(paper.doi).toBeNull();
    expect(paper.abstract).toBeNull();
    expect(paper.openAccessUrl).toBeNull();
  });

  it('rejects unsafe or malformed source links', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,test',
      'https://user:secret@example.com',
      'not a url',
    ])
      expect(safeUrl(url)).toBeNull();
    expect(normalizeWork(work('W1', { doi: 'fake-doi' })).doi).toBeNull();
  });
});

describe('search workflow', () => {
  it('requests bounded structured output matching the validated search plan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        if (String(url).includes('/chat/completions')) {
          const body = JSON.parse(String(init.body));
          const { schema, strict } = body.response_format.json_schema;
          expect(strict).toBe(true);
          expect(schema.additionalProperties).toBe(false);
          expect(schema.required).toEqual(['question', 'concepts', 'queries']);
          expect(schema.properties.question).toMatchObject({
            minLength: 3,
            maxLength: 700,
          });
          expect(schema.properties.queries).toMatchObject({
            minItems: 1,
            maxItems: 3,
            items: { minLength: 2, maxLength: 250 },
          });
          expect(schema.properties.concepts).toMatchObject({
            minItems: 1,
            maxItems: 6,
            items: {
              additionalProperties: false,
              properties: {
                label: { maxLength: 70 },
                description: { maxLength: 250 },
              },
            },
          });
          return routerPlan();
        }
        return Response.json({ results: [work()] });
      }),
    );
    const result = await search(
      { ...input, query: 'pothole detection' },
      { ...env, OPENROUTER_API_KEY: 'test' },
      () => {},
      new AbortController().signal,
    );
    expect(result.plan.source).toBe('agent');
    expect(result.warnings).toEqual([]);
  });

  it.each(['', null, JSON.stringify(plan)])(
    'reports length-limited output before parsing content %j',
    async (content) => {
      const searched: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL) => {
          if (String(url).includes('/chat/completions'))
            return Response.json({
              choices: [
                {
                  finish_reason: 'length',
                  message: {
                    content,
                    reasoning: 'Unfinished internal analysis',
                  },
                },
              ],
            });
          searched.push(new URL(url).searchParams.get('search')!);
          return Response.json({ results: [work()] });
        }),
      );
      const result = await search(
        input,
        { ...env, OPENROUTER_API_KEY: 'test' },
        () => {},
        new AbortController().signal,
      );
      expect(result.plan.source).toBe('keywords');
      expect(searched).toEqual([input.query]);
      expect(result.warnings).toEqual([
        'The agent reached its output limit before completing the search plan. Using your original keywords.',
      ]);
      expect(JSON.stringify(result)).not.toContain('internal analysis');
    },
  );

  it.each(['', '   ', null])(
    'reports an empty completed response for content %j',
    async (content) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL) => {
          if (String(url).includes('/chat/completions'))
            return Response.json({
              choices: [{ finish_reason: 'stop', message: { content } }],
            });
          return Response.json({ results: [work()] });
        }),
      );
      const result = await search(
        input,
        { ...env, OPENROUTER_API_KEY: 'test' },
        () => {},
        new AbortController().signal,
      );
      expect(result.plan.source).toBe('keywords');
      expect(result.warnings).toEqual([
        'The agent returned an empty search plan. Using your original keywords.',
      ]);
    },
  );

  it('works without OpenRouter, emits an honest keyword plan, and applies year filters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ results: [work()] }));
    vi.stubGlobal('fetch', fetchMock);
    const events: SearchEvent[] = [];
    const result = await search(
      { ...input, fromYear: 2020 },
      env,
      (event) => events.push(event),
      new AbortController().signal,
    );
    expect(result.plan).toEqual(keywordPlan(input.query));
    expect(result.ranking).toBe('openalex');
    expect(result.warnings).toHaveLength(1);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('filter')).toBe(
      'is_retracted:false,from_publication_date:2020-01-01',
    );
    expect(events.map((event) => event.type)).toEqual([
      'phase',
      'plan',
      'phase',
    ]);
  });

  it('plans multiple searches, deduplicates papers, and ranks with the actual Decisions API contract', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
      if (String(url).includes('/chat/completions')) return routerPlan();
      if (String(url).includes('/alpha/decisions')) {
        const body = JSON.parse(String(init.body));
        expect(body.questions.paper_0.type).toBe('noul');
        expect(body.state.researchIdea).toBe(input.query);
        return Response.json({
          answers: {
            paper_0: { type: 'noul', noul: 0.2 },
            paper_1: { type: 'noul', noul: 0.92 },
          },
        });
      }
      expect(new Headers(init.headers).get('Authorization')).toBe(
        'Bearer openalex-secret',
      );
      return Response.json({
        results: [
          work(),
          work('W2', { doi: 'https://doi.org/10.1234/green.2' }),
          work('W3'),
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await search(
      { ...input, useDecisions: true },
      {
        ...env,
        OPENROUTER_API_KEY: 'router-secret',
        OPENALEX_API_KEY: 'openalex-secret',
      },
      () => {},
      new AbortController().signal,
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.retrieved).toBe(2);
    expect(result.papers.map((paper) => paper.score)).toEqual([0.92, 0.2]);
    expect(result.ranking).toBe('jev');
    expect(result.plan.source).toBe('agent');
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('keeps valid results when one expanded query fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('/chat/completions')) return routerPlan();
        if (new URL(url).searchParams.get('search') === plan.queries[0])
          return new Response('', { status: 503 });
        return Response.json({ results: [work()] });
      }),
    );
    const result = await search(
      input,
      { ...env, OPENROUTER_API_KEY: 'test' },
      () => {},
      new AbortController().signal,
    );
    expect(result.papers).toHaveLength(1);
    expect(result.queriesSearched).toEqual([plan.queries[1]]);
    expect(result.warnings[0]).toContain('Some OpenAlex searches failed');
  });

  it('falls back when planning fails and rejects incomplete Jev scores atomically', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('/chat/completions'))
          return Response.json({
            choices: [{ message: { content: '{"question":"bad"}' } }],
          });
        if (String(url).includes('/alpha/decisions'))
          return Response.json({
            answers: { paper_0: { type: 'noul', noul: 0.9 } },
          });
        return Response.json({ results: [work(), work('W2', { doi: null })] });
      }),
    );
    const result = await search(
      { ...input, useDecisions: true },
      { ...env, OPENROUTER_API_KEY: 'test' },
      () => {},
      new AbortController().signal,
    );
    expect(result.plan.source).toBe('keywords');
    expect(result.ranking).toBe('openalex');
    expect(result.papers.every((paper) => paper.score === null)).toBe(true);
    expect(result.warnings).toHaveLength(2);
  });

  it('requires a usable open-access link in Read papers mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        expect(url.searchParams.get('filter')).toContain(
          'open_access.is_oa:true',
        );
        return Response.json({
          results: [
            work(),
            work('W2', {
              doi: null,
              best_oa_location: { is_oa: true, pdf_url: 'javascript:alert(1)' },
            }),
          ],
        });
      }),
    );
    const result = await search(
      { ...input, mode: 'fulltext', useAgent: false },
      env,
      () => {},
      new AbortController().signal,
    );
    expect(result.papers).toHaveLength(1);
  });

  it('surfaces rate limits when every OpenAlex search fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 429 })),
    );
    await expect(
      search(input, env, () => {}, new AbortController().signal),
    ).rejects.toThrow('OpenAlex is rate limited');
  });

  it('does not return success after cancellation', async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        abort.abort();
        return Response.json({ results: [work()] });
      }),
    );
    await expect(
      search({ ...input, useAgent: false }, env, () => {}, abort.signal),
    ).rejects.toThrow('cancelled');
  });
});

describe('Worker API', () => {
  it('exposes configuration without secret values', async () => {
    const response = await worker.fetch(
      new Request('https://litagent.example/api/config'),
      {
        ...env,
        OPENROUTER_API_KEY: 'private',
        LITAGENT_ACCESS_TOKEN: 'secret',
      },
    );
    const data = await response.json();
    expect(data).toMatchObject({ agent: true, accessProtected: true });
    expect(JSON.stringify(data)).not.toMatch(/private|secret/);
  });

  it('enforces agent-on, Jev-off, any-year defaults despite client overrides', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/chat/completions')) return routerPlan();
      expect(new URL(url).origin).toBe('https://api.openalex.org');
      expect(new URL(url).searchParams.get('filter')).toBe(
        'is_retracted:false',
      );
      return Response.json({ results: [work()] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(
      request({
        query: input.query,
        useAgent: false,
        useDecisions: true,
        fromYear: 3000,
        mode: 'fulltext',
        ENABLE_AGENT: 'false',
        ENABLE_JEV: 'true',
      }),
      { ...env, OPENROUTER_API_KEY: 'test' },
    );
    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.at(-1).result).toMatchObject({
      mode: 'citations',
      plan: { source: 'agent' },
      ranking: 'openalex',
      warnings: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('enforces operator-selected planning, relevance, and year settings', async () => {
    const configuredEnv = {
      ...env,
      OPENROUTER_API_KEY: 'test',
      ENABLE_AGENT: 'false',
      ENABLE_JEV: 'true',
      SEARCH_FROM_YEAR: '2020',
    };
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/alpha/decisions'))
        return Response.json({
          answers: { paper_0: { type: 'noul', noul: 0.92 } },
        });
      expect(new URL(url).origin).toBe('https://api.openalex.org');
      expect(new URL(url).searchParams.get('filter')).toBe(
        'is_retracted:false,from_publication_date:2020-01-01',
      );
      return Response.json({ results: [work()] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const config = await worker.fetch(
      new Request('https://litagent.example/api/config'),
      configuredEnv,
    );
    expect(await config.json()).toMatchObject({ agent: false });
    const response = await worker.fetch(
      request({
        ...input,
        useAgent: true,
        useDecisions: false,
        fromYear: 2010,
      }),
      configuredEnv,
    );
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.at(-1).result).toMatchObject({
      plan: { source: 'keywords' },
      ranking: 'jev',
      papers: [{ score: 0.92 }],
      warnings: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('makes no model calls when the operator disables both model features', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(new URL(url).origin).toBe('https://api.openalex.org');
      return Response.json({ results: [work()] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(
      request({ ...input, useAgent: true, useDecisions: true }),
      {
        ...env,
        OPENROUTER_API_KEY: 'test',
        ENABLE_AGENT: 'false',
        ENABLE_JEV: 'false',
      },
    );
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.at(-1).result).toMatchObject({
      plan: { source: 'keywords' },
      ranking: 'openalex',
      warnings: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ENABLE_AGENT: 'TRUE' },
    { ENABLE_JEV: '1' },
    { SEARCH_FROM_YEAR: 'not-a-year' },
    { SEARCH_FROM_YEAR: '1799' },
    { SEARCH_FROM_YEAR: String(new Date().getUTCFullYear() + 1) },
  ])(
    'rejects invalid operator configuration before provider calls: %j',
    async (settings) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const configuredEnv = { ...env, ...settings };
      const config = await worker.fetch(
        new Request('https://litagent.example/api/config'),
        configuredEnv,
      );
      expect(config.status).toBe(503);
      const response = await worker.fetch(
        request({ query: input.query }),
        configuredEnv,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('Invalid search configuration'),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['1800', String(new Date().getUTCFullYear())])(
    'accepts the publication-year boundary %s',
    async (year) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: URL) => {
          expect(url.searchParams.get('filter')).toBe(
            `is_retracted:false,from_publication_date:${year}-01-01`,
          );
          return Response.json({ results: [work()] });
        }),
      );
      const response = await worker.fetch(request({ query: input.query }), {
        ...env,
        SEARCH_FROM_YEAR: year,
      });
      expect(response.status).toBe(200);
      const events = (await response.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events.at(-1).type).toBe('result');
    },
  );

  it('validates input before making provider calls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const body of [
      { query: 'a' },
      { query: 'x'.repeat(501) },
      { query: 123 },
      null,
    ])
      expect((await worker.fetch(request(body), env)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies, cross-origin requests, unauthorized searches, and exhausted local limits', async () => {
    expect(
      (await worker.fetch(request({ query: 'x'.repeat(9000) }), env)).status,
    ).toBe(413);
    expect(
      (
        await worker.fetch(
          request(input, { Origin: 'https://another.example' }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await worker.fetch(request(input), {
          ...env,
          LITAGENT_ACCESS_TOKEN: 'secret',
        })
      ).status,
    ).toBe(401);
    const limited = {
      ...env,
      SEARCH_RATE_LIMITER: {
        limit: vi.fn().mockResolvedValue({ success: false }),
      },
    } as unknown as Env;
    expect((await worker.fetch(request(input), limited)).status).toBe(429);
  });

  it('streams plan, phases, and the complete result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ results: [work()] })),
    );
    const response = await worker.fetch(request(input), env);
    expect(response.headers.get('Content-Type')).toBe('application/x-ndjson');
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual([
      'phase',
      'plan',
      'phase',
      'result',
    ]);
    expect(events.at(-1).result.papers[0].doi).toBe('10.1234/green.1');
  });

  it('streams provider failures as terminal errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 401 })),
    );
    const response = await worker.fetch(request(input), env);
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('OpenAlex rejected'),
    });
    expect(events.some((event) => event.type === 'result')).toBe(false);
  });
});

describe('Sci-Hub lookups', () => {
  it('uses the verified DOI path and encodes reserved characters without changing the host', () => {
    expect(getSciHubUrl('10.1038/s41586-021-03819-2')).toBe(
      'https://www.sci-hub.in/10.1038/s41586-021-03819-2',
    );
    const doi = '10.1234/chapter/a?b#c%20';
    const url = new URL(getSciHubUrl(doi)!);
    expect(url.origin).toBe('https://www.sci-hub.in');
    expect(decodeURIComponent(url.pathname.slice(1))).toBe(doi);
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    for (const invalid of [
      null,
      '',
      'https://evil.example',
      '10.1234/',
      '10.1234/../about',
      '10.1234/paper with spaces',
      `10.1234/${'x'.repeat(500)}`,
      '10.1234/\ud800',
    ])
      expect(getSciHubUrl(invalid)).toBeNull();
  });

  it('keeps the capability and redirect disabled unless explicitly enabled by the environment', async () => {
    for (const flag of [undefined, '', 'false', '0', '1', 'TRUE']) {
      const disabledEnv = { ...env, ENABLE_SCIHUB: flag };
      const config = await worker.fetch(
        new Request('https://litagent.example/api/config'),
        disabledEnv,
      );
      expect(await config.json()).toMatchObject({ sciHubEnabled: false });
      const response = await worker.fetch(
        new Request(
          'https://litagent.example/api/paper/scihub?doi=10.1234/paper',
        ),
        disabledEnv,
      );
      expect(response.status).toBe(404);
      expect(response.headers.has('Location')).toBe(false);
    }
  });

  it('redirects a valid DOI only on the enabled Worker and does not call external providers', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const enabledEnv = { ...env, ENABLE_SCIHUB: 'true' };
    const config = await worker.fetch(
      new Request('https://litagent.example/api/config'),
      enabledEnv,
    );
    expect(await config.json()).toMatchObject({ sciHubEnabled: true });
    const doi = '10.1234/chapter/a?b#c%20';
    const response = await worker.fetch(
      new Request(
        `https://litagent.example/api/paper/scihub?doi=${encodeURIComponent(doi)}`,
      ),
      enabledEnv,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(getSciHubUrl(doi));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      (
        await worker.fetch(
          new Request('https://litagent.example/api/paper/scihub'),
          enabledEnv,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await worker.fetch(
          new Request(
            'https://litagent.example/api/paper/scihub?doi=https://evil.example',
          ),
          enabledEnv,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await worker.fetch(
          new Request(
            'https://litagent.example/api/paper/scihub?doi=10.1234/paper',
            { method: 'POST' },
          ),
          enabledEnv,
        )
      ).status,
    ).toBe(405);
  });

  it('allows DOI lookups alongside open-access papers in Read papers mode without claiming availability', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        expect(url.searchParams.get('filter')).toBe('is_retracted:false');
        return Response.json({
          results: [
            work(),
            work('W2', {
              doi: 'https://doi.org/10.1234/closed',
              best_oa_location: null,
            }),
            work('W3', { doi: null, best_oa_location: null }),
            work('W4', { doi: null }),
            work('W5', {
              doi: 'https://doi.org/10.1234/../about',
              best_oa_location: null,
            }),
          ],
        });
      }),
    );
    const result = await search(
      { ...input, mode: 'fulltext', useAgent: false },
      { ...env, ENABLE_SCIHUB: 'true' },
      () => {},
      new AbortController().signal,
    );
    expect(result.papers.map((paper) => paper.id)).toEqual([
      'https://openalex.org/W1',
      'https://openalex.org/W2',
      'https://openalex.org/W4',
    ]);
    expect(result.papers[1].openAccessUrl).toBeNull();
    expect(result.papers[1].pdfUrl).toBeNull();
    expect(result.papers[2].doi).toBeNull();
  });

  it('does not allow client input to enable DOI lookups or change citation mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        expect(url.searchParams.get('filter')).toBe('is_retracted:false');
        return Response.json({
          results: [
            work('W2', {
              doi: 'https://doi.org/10.1234/closed',
              best_oa_location: null,
            }),
          ],
        });
      }),
    );
    const response = await worker.fetch(
      request({
        ...input,
        mode: 'fulltext',
        useAgent: false,
        sciHubEnabled: true,
        ENABLE_SCIHUB: 'true',
      }),
      env,
    );
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.at(-1).result.mode).toBe('citations');
    expect(events.at(-1).result.papers[0].doi).toBe('10.1234/closed');
  });
});

describe('browser stream reader', () => {
  it('reassembles fragmented UTF-8 events and an unterminated last line', async () => {
    const events = [
      { type: 'phase', phase: 'planning', message: 'Exploring café…' },
      { type: 'result', result: {} },
    ];
    const bytes = new TextEncoder().encode(
      events.map((event) => JSON.stringify(event)).join('\n'),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < bytes.length; i += 7)
                controller.enqueue(bytes.slice(i, i + 7));
              controller.close();
            },
          }),
        ),
      ),
    );
    const received: SearchEvent[] = [];
    await streamSearch(input, '', new AbortController().signal, (event) =>
      received.push(event),
    );
    expect(received).toEqual(events);
  });

  it('rejects truncated streams instead of displaying false success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '{"type":"phase","phase":"searching","message":"Searching"}\n',
          ),
        ),
    );
    await expect(
      streamSearch(input, '', new AbortController().signal, () => {}),
    ).rejects.toThrow('ended early');
  });
});
