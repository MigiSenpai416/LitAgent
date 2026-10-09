import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchPlan, SearchResult } from '../shared/types';
import { deduplicatePapers } from '../shared/papers';
import { mergeSearchResults, searchRound } from '../src/search-context';
import worker from '../worker/index';
import { refinementSchema, searchInputSchema } from '../worker/schema';
import { normalizeWork, search, type Env } from '../worker/search';

const query = 'urban green spaces mental health';
const plan: SearchPlan = {
  question: 'How do green spaces affect mental health?',
  concepts: [
    { label: 'Green spaces', description: 'Parks and vegetation in cities' },
  ],
  queries: [
    'urban parks wellbeing',
    'green space adolescent anxiety',
    'urban green space health',
  ],
  source: 'agent',
};
const env = {
  ASSETS: { fetch: vi.fn() },
  OPENROUTER_API_KEY: 'test-key',
} as unknown as Env;

function work(id: number) {
  return {
    id: `https://openalex.org/W${id}`,
    display_name: `Paper ${id}`,
    doi: `https://doi.org/10.1234/paper.${id}`,
    publication_year: 2024,
  };
}

function input(overrides: object = {}) {
  return searchInputSchema.parse({ query, ...overrides });
}

function result(
  ids: number[],
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    query,
    mode: 'citations',
    plan,
    papers: ids.map((id) => normalizeWork(work(id))),
    retrieved: ids.length,
    queriesSearched: [plan.queries[0]],
    ranking: 'openalex',
    warnings: [],
    elapsedMs: 100,
    pagination: {
      plan,
      paths: [{ query: plan.queries[0], cursor: 'next-page' }],
    },
    ...overrides,
  };
}

function request(body: unknown) {
  return new Request('https://litagent.example/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function completion() {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(plan) } }],
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenAlex cursor pages', () => {
  it('keeps all 300 unique results from three 100-paper search paths', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('/chat/completions')) return completion();
        const searchUrl = new URL(url);
        const path = plan.queries.indexOf(
          searchUrl.searchParams.get('search')!,
        );
        expect(searchUrl.searchParams.get('per_page')).toBe('100');
        expect(searchUrl.searchParams.get('cursor')).toBe('*');
        return Response.json({
          meta: { next_cursor: `path-${path}-page-2` },
          results: Array.from({ length: 100 }, (_, index) =>
            work((path + 1) * 1000 + index),
          ),
        });
      }),
    );
    const found = await search(
      input(),
      env,
      () => {},
      new AbortController().signal,
    );
    expect(found.papers).toHaveLength(300);
    expect(found.retrieved).toBe(300);
    expect(found.papers.slice(0, 3).map((paper) => paper.id)).toEqual([
      'https://openalex.org/W1000',
      'https://openalex.org/W2000',
      'https://openalex.org/W3000',
    ]);
    expect(found.pagination?.paths).toEqual(
      plan.queries.map((query, index) => ({
        query,
        cursor: `path-${index}-page-2`,
      })),
    );
    expect(
      refinementSchema.safeParse({
        instructions: 'Focus on adolescents',
        history: [searchRound(found)],
      }).success,
    ).toBe(true);
  });

  it('continues existing paths without replanning and removes only exhausted paths', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const searchUrl = new URL(url);
      expect(searchUrl.origin).toBe('https://api.openalex.org');
      const path = plan.queries.indexOf(searchUrl.searchParams.get('search')!);
      expect(searchUrl.searchParams.get('cursor')).toBe(`path-${path}-page-2`);
      return Response.json({
        meta: { next_cursor: path === 1 ? null : `path-${path}-page-3` },
        results: [work(path + 1), work(path + 10)],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const previous = result([1, 2, 3]);
    const next = await search(
      input({
        pagination: {
          plan,
          paths: plan.queries.map((query, index) => ({
            query,
            cursor: `path-${index}-page-2`,
          })),
        },
      }),
      env,
      () => {},
      new AbortController().signal,
    );
    const merged = mergeSearchResults(previous, next);
    expect(merged.papers).toHaveLength(6);
    expect(merged.retrieved).toBe(6);
    expect(merged.pagination?.paths).toEqual([
      { query: plan.queries[0], cursor: 'path-0-page-3' },
      { query: plan.queries[2], cursor: 'path-2-page-3' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('preserves a failed path at its current cursor while advancing successful paths', async () => {
    const paths = plan.queries.map((query, index) => ({
      query,
      cursor: `cursor-${index}`,
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        const path = plan.queries.indexOf(url.searchParams.get('search')!);
        if (path === 0) return new Response('', { status: 503 });
        return Response.json({
          meta: { next_cursor: path === 1 ? 'following-cursor' : null },
          results: [work(path)],
        });
      }),
    );
    const next = await search(
      input({ pagination: { plan, paths } }),
      env,
      () => {},
      new AbortController().signal,
    );
    expect(next.papers).toHaveLength(2);
    expect(next.pagination?.paths).toEqual([
      paths[0],
      { query: plan.queries[1], cursor: 'following-cursor' },
    ]);
    expect(next.warnings[0]).toContain('Some OpenAlex searches failed');
    const retry = vi.fn(async (url: URL) => {
      const path = plan.queries.indexOf(url.searchParams.get('search')!);
      expect(url.searchParams.get('cursor')).toBe(
        path === 0 ? 'cursor-0' : 'following-cursor',
      );
      return Response.json({
        meta: { next_cursor: null },
        results: [work(path + 10)],
      });
    });
    vi.stubGlobal('fetch', retry);
    const last = await search(
      input({ pagination: next.pagination }),
      env,
      () => {},
      new AbortController().signal,
    );
    expect(last.pagination).toBeNull();
    expect(mergeSearchResults(next, last).papers).toHaveLength(4);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('allows more pages after a batch contains only filtered papers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          meta: { next_cursor: 'later-page' },
          results: [{ ...work(1), is_retracted: true }],
        }),
      ),
    );
    const found = await search(
      input({ useAgent: false }),
      env,
      () => {},
      new AbortController().signal,
    );
    expect(found.papers).toEqual([]);
    expect(found.pagination?.paths).toEqual([{ query, cursor: 'later-page' }]);
  });

  it('keeps papers already collected when the final page is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ meta: { next_cursor: null }, results: [] }),
        ),
    );
    const previous = result([1, 2]);
    const next = await search(
      input({ pagination: previous.pagination }),
      env,
      () => {},
      new AbortController().signal,
    );
    const merged = mergeSearchResults(previous, next);
    expect(merged.papers).toEqual(previous.papers);
    expect(merged.retrieved).toBe(2);
    expect(merged.pagination).toBeNull();
  });

  it('reports failures without mutating the continuation needed for a retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 429 })),
    );
    const previous = result([1]);
    const before = JSON.stringify(previous);
    await expect(
      search(
        input({ pagination: previous.pagination }),
        env,
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('rate limited');
    expect(JSON.stringify(previous)).toBe(before);
  });

  it('rejects a repeated cursor instead of looping through the same page', async () => {
    const previous = result([1]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          meta: { next_cursor: 'next-page' },
          results: [work(1)],
        }),
      ),
    );
    await expect(
      search(
        input({ pagination: previous.pagination }),
        env,
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('repeated page cursor');
  });

  it('does not return a loaded page after cancellation', async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        abort.abort();
        return Response.json({
          meta: { next_cursor: null },
          results: [work(2)],
        });
      }),
    );
    await expect(
      search(
        input({ pagination: result([1]).pagination }),
        env,
        () => {},
        abort.signal,
      ),
    ).rejects.toThrow('cancelled');
  });
});

describe('ranking larger result batches', () => {
  it('ranks every paper in bounded requests and sorts scores across all batches', async () => {
    const sizes: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        if (String(url).includes('/alpha/decisions')) {
          const body = JSON.parse(String(init.body));
          sizes.push(body.state.papers.length);
          expect(Object.keys(body.questions)).toHaveLength(
            body.state.papers.length,
          );
          return Response.json({
            answers: Object.fromEntries(
              body.state.papers.map(
                (paper: { title: string }, index: number) => [
                  `paper_${index}`,
                  {
                    type: 'noul',
                    noul: Number(paper.title.split(' ')[1]) / 100,
                  },
                ],
              ),
            ),
          });
        }
        return Response.json({
          meta: { next_cursor: 'next' },
          results: Array.from({ length: 100 }, (_, index) => work(index + 1)),
        });
      }),
    );
    const found = await search(
      input({ useAgent: false, useDecisions: true }),
      env,
      () => {},
      new AbortController().signal,
    );
    expect(sizes).toEqual([40, 40, 20]);
    expect(found.papers).toHaveLength(100);
    expect(found.ranking).toBe('jev');
    expect(found.papers[0]).toMatchObject({ title: 'Paper 100', score: 1 });
    expect(found.papers.at(-1)).toMatchObject({
      title: 'Paper 1',
      score: 0.01,
    });
  });

  it('preserves all retrieved papers without partial scores when a ranking batch fails', async () => {
    let decisions = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        if (String(url).includes('/alpha/decisions')) {
          if (++decisions === 2) return new Response('', { status: 503 });
          const body = JSON.parse(String(init.body));
          return Response.json({
            answers: Object.fromEntries(
              Object.keys(body.questions).map((key) => [
                key,
                { type: 'noul', noul: 0.9 },
              ]),
            ),
          });
        }
        return Response.json({
          meta: { next_cursor: 'next' },
          results: Array.from({ length: 100 }, (_, index) => work(index + 1)),
        });
      }),
    );
    const found = await search(
      input({ useAgent: false, useDecisions: true }),
      env,
      () => {},
      new AbortController().signal,
    );
    expect(found.papers).toHaveLength(100);
    expect(found.papers.every((paper) => paper.score === null)).toBe(true);
    expect(found.ranking).toBe('openalex');
    expect(found.pagination?.paths[0].cursor).toBe('next');
  });
});

describe('accumulated result merging', () => {
  it('deduplicates identifiers and case-insensitive DOIs without inflating loaded counts', () => {
    const previous = result([1]);
    const next = result([1, 2, 3]);
    next.papers[1].doi = previous.papers[0].doi!.toUpperCase();
    const merged = mergeSearchResults(previous, next);
    expect(merged.papers.map((paper) => paper.id)).toEqual([
      'https://openalex.org/W1',
      'https://openalex.org/W3',
    ]);
    expect(merged.retrieved).toBe(2);
    expect(previous.papers).toHaveLength(1);
    expect(next.papers).toHaveLength(3);
  });

  it.each(['same ID', 'same DOI'])(
    'updates an unscored duplicate with a later successful estimate: %s',
    (match) => {
      const previous = result([1]);
      const next = result([match === 'same ID' ? 1 : 2, 3]);
      next.papers[0].doi = previous.papers[0].doi!.toUpperCase();
      next.papers[0].score = 0.95;
      next.papers[1].score = 0.9;
      const merged = mergeSearchResults(previous, next);
      expect(merged.papers).toHaveLength(2);
      expect(merged.papers[0]).toMatchObject({
        id: previous.papers[0].id,
        score: 0.95,
      });
      expect(merged.ranking).toBe('jev');
      expect(
        merged.papers.filter(
          (paper) => paper.score !== null && paper.score >= 0.7,
        ),
      ).toHaveLength(2);
      expect(previous.papers[0].score).toBeNull();
    },
  );

  it('keeps valid existing scores while distinguishing partial ranking coverage', () => {
    const previous = result([1]);
    previous.papers[0].score = 0;
    const next = result([1, 2]);
    next.papers[0].score = 0.8;
    const merged = mergeSearchResults(previous, next);
    expect(merged.papers[0].score).toBe(0);
    expect(merged.ranking).toBe('mixed');
    expect(
      deduplicatePapers([...previous.papers, ...next.papers]),
    ).toHaveLength(2);
  });

  it('retains continuation after duplicate-only pages and allows refinement after hundreds of results', () => {
    const previous = result(Array.from({ length: 500 }, (_, index) => index));
    const next = result([0, 1], {
      pagination: {
        plan,
        paths: [{ query: plan.queries[0], cursor: 'following-page' }],
      },
    });
    const merged = mergeSearchResults(previous, next);
    expect(merged.papers).toHaveLength(500);
    expect(merged.pagination).toEqual(next.pagination);
    const parsed = refinementSchema.safeParse({
      instructions: 'Focus on intervention studies',
      history: [searchRound(merged)],
    });
    expect(parsed.success).toBe(true);
    expect(searchRound(merged).returned).toBe(500);
    expect(searchRound(merged).sampleTitles).toHaveLength(5);
  });
});

describe('pagination API validation', () => {
  it('accepts bounded cursor payloads above 8 KiB and enforces server search settings', async () => {
    const pagination = {
      plan,
      paths: plan.queries.map((query) => ({ query, cursor: 'x'.repeat(3500) })),
    };
    const body = {
      query,
      pagination,
      useAgent: false,
      useDecisions: false,
      mode: 'fulltext',
      fromYear: 3000,
    };
    expect(JSON.stringify(body).length).toBeGreaterThan(8192);
    const fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
      if (String(url).includes('/alpha/decisions')) {
        const sent = JSON.parse(String(init.body));
        return Response.json({
          answers: Object.fromEntries(
            Object.keys(sent.questions).map((key) => [
              key,
              { type: 'noul', noul: 0.9 },
            ]),
          ),
        });
      }
      expect(new URL(url).origin).toBe('https://api.openalex.org');
      expect(new URL(url).searchParams.get('filter')).toBe(
        'is_retracted:false,from_publication_date:2020-01-01',
      );
      return Response.json({ meta: { next_cursor: null }, results: [work(1)] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(request(body), {
      ...env,
      ENABLE_JEV: 'true',
      SEARCH_FROM_YEAR: '2020',
    });
    expect(response.status).toBe(200);
    const events = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: 'result',
      result: { mode: 'citations', ranking: 'jev', pagination: null },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    { plan, paths: [] },
    { plan, paths: [{ query: 'unrelated query', cursor: 'next' }] },
    { plan, paths: [{ query: plan.queries[0], cursor: '' }] },
    { plan, paths: [{ query: plan.queries[0], cursor: 'x'.repeat(4097) }] },
    {
      plan,
      paths: [
        { query: plan.queries[0], cursor: 'next' },
        { query: plan.queries[0], cursor: 'another' },
      ],
    },
  ])(
    'rejects invalid pagination before provider calls: %j',
    async (pagination) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const response = await worker.fetch(request({ query, pagination }), env);
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
