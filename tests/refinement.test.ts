import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SEARCH_ROUNDS,
  type SearchEvent,
  type SearchPlan,
  type SearchResult,
} from '../shared/types';
import { searchRound } from '../src/search-context';
import worker from '../worker/index';
import { refinementSchema, searchInputSchema } from '../worker/schema';
import { keywordPlan, normalizeWork, search, type Env } from '../worker/search';

const originalQuery = 'urban green spaces mental health';
const originalPlan: SearchPlan = {
  question: 'How do urban green spaces affect mental health?',
  concepts: [
    { label: 'Green spaces', description: 'Parks and vegetation in cities' },
    { label: 'Mental health', description: 'Psychological wellbeing' },
  ],
  queries: ['urban parks wellbeing'],
  source: 'agent',
};
const earlierFeedback = 'Focus on adolescent anxiety';
const earlierPlan: SearchPlan = {
  ...originalPlan,
  question: 'How do urban green spaces affect anxiety in adolescents?',
  queries: ['urban green space adolescent anxiety'],
};
const latestFeedback =
  'Include longitudinal studies and exclude adult-only samples';
const revisedPlan: SearchPlan = {
  ...earlierPlan,
  question:
    'What do longitudinal studies show about urban green spaces and adolescent anxiety, excluding adult-only samples?',
  queries: [
    'green space adolescent anxiety longitudinal',
    'urban parks youth anxiety',
  ],
};
const work = {
  id: 'https://openalex.org/W2',
  display_name: 'Longitudinal evidence on green space and adolescent anxiety',
  doi: 'https://doi.org/10.1234/youth',
  publication_year: 2024,
  abstract_inverted_index: { Adolescent: [0], anxiety: [1] },
};
const paper = normalizeWork(work);
const env = {
  ASSETS: { fetch: vi.fn() },
  OPENROUTER_API_KEY: 'test-key',
} as unknown as Env;

function previousResult(plan = originalPlan): SearchResult {
  return {
    query: originalQuery,
    mode: 'citations',
    plan,
    papers: [
      { ...paper, id: 'https://openalex.org/W1', title: 'Earlier results' },
    ],
    retrieved: 1,
    queriesSearched: plan.queries,
    ranking: 'openalex',
    warnings: [],
    elapsedMs: 100,
  };
}

const history = [
  searchRound(previousResult()),
  searchRound(previousResult(earlierPlan), earlierFeedback),
];
const refinement = { instructions: latestFeedback, history };

function request(body: unknown) {
  return new Request('https://litagent.example/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function completion(plan = revisedPlan) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(plan) } }],
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('search refinement', () => {
  it('uses the complete history to plan fresh searches and ranks against the updated intent', async () => {
    const queries: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      if (String(url).includes('/chat/completions')) {
        expect(JSON.parse(body.messages[1].content)).toEqual({
          researchIdea: originalQuery,
          previousSearches: history,
          refinementFeedback: latestFeedback,
        });
        expect(body.messages[0].content).toContain(
          'latest feedback takes precedence',
        );
        return completion();
      }
      if (String(url).includes('/alpha/decisions')) {
        expect(body.state).toMatchObject({
          researchIdea: revisedPlan.question,
          originalResearchIdea: originalQuery,
          refinementInstructions: [earlierFeedback, latestFeedback],
        });
        expect(body.state.papers[0].title).toBe(work.display_name);
        return Response.json({
          answers: { paper_0: { type: 'noul', noul: 0.9 } },
        });
      }
      const searchUrl = new URL(url);
      queries.push(searchUrl.searchParams.get('search')!);
      expect(searchUrl.searchParams.get('filter')).toContain('2021-01-01');
      return Response.json({ results: [work] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const events: SearchEvent[] = [];
    const result = await search(
      searchInputSchema.parse({
        query: originalQuery,
        refinement,
        useDecisions: true,
        fromYear: 2021,
      }),
      env,
      (event) => events.push(event),
      new AbortController().signal,
    );
    expect(queries).toEqual(revisedPlan.queries);
    expect(result).toMatchObject({
      query: originalQuery,
      plan: revisedPlan,
      retrieved: 1,
      ranking: 'jev',
      warnings: [],
      papers: [{ id: work.id, score: 0.9 }],
    });
    expect(events.map((event) => event.type)).toEqual([
      'phase',
      'plan',
      'phase',
      'phase',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(history).toHaveLength(2);
  });

  it.each(['invalid plan', 'output limit', 'provider error'])(
    'keeps refinement feedback out of keyword fallback after a planning failure: %s',
    async (failure) => {
      const response =
        failure === 'provider error'
          ? new Response('', { status: 429 })
          : Response.json({
              choices: [
                {
                  finish_reason: failure === 'output limit' ? 'length' : 'stop',
                  message: { content: '{"question":"incomplete"}' },
                },
              ],
            });
      const fetchMock = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        search(
          searchInputSchema.parse({ query: originalQuery, refinement }),
          env,
          () => {},
          new AbortController().signal,
        ),
      ).rejects.toThrow('Your previous results are still available');
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(String(fetchMock.mock.calls[0][0])).toContain('/chat/completions');
    },
  );

  it('can refine a completed search with no results', async () => {
    const empty = { ...previousResult(), papers: [], retrieved: 0 };
    const fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
      if (String(url).includes('/chat/completions')) {
        const body = JSON.parse(String(init.body));
        expect(
          JSON.parse(body.messages[1].content).previousSearches[0],
        ).toMatchObject({
          retrieved: 0,
          returned: 0,
          sampleTitles: [],
        });
        return completion();
      }
      return Response.json({ results: [work] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await search(
      searchInputSchema.parse({
        query: originalQuery,
        refinement: {
          instructions: 'Broaden the population',
          history: [searchRound(empty)],
        },
      }),
      env,
      () => {},
      new AbortController().signal,
    );
    expect(result.papers).toHaveLength(1);
  });

  it('does not complete a refinement after cancellation during planning', async () => {
    const abort = new AbortController();
    const fetchMock = vi.fn(async () => {
      abort.abort();
      return completion();
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      search(
        searchInputSchema.parse({ query: originalQuery, refinement }),
        env,
        () => {},
        abort.signal,
      ),
    ).rejects.toThrow('cancelled');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('refinement API boundaries', () => {
  it('accepts validated history above the ordinary request limit and preserves server settings', async () => {
    const largeHistory = Array.from({ length: 3 }, (_, index) => ({
      ...history[0],
      instructions: index ? 'Focus on adolescent anxiety' : null,
      plan: {
        ...originalPlan,
        question: 'q'.repeat(700),
        concepts: Array.from({ length: 6 }, () => ({
          label: 'l'.repeat(70),
          description: 'd'.repeat(250),
        })),
      },
      sampleTitles: Array.from({ length: 5 }, () => 't'.repeat(200)),
    }));
    const body = {
      query: originalQuery,
      refinement: { instructions: latestFeedback, history: largeHistory },
      useAgent: false,
      useDecisions: false,
      mode: 'fulltext',
      fromYear: 3000,
    };
    expect(
      new TextEncoder().encode(JSON.stringify(body)).byteLength,
    ).toBeGreaterThan(8192);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init: RequestInit) => {
        if (String(url).includes('/chat/completions')) {
          const sent = JSON.parse(String(init.body));
          expect(JSON.parse(sent.messages[1].content).previousSearches).toEqual(
            largeHistory,
          );
          return completion();
        }
        if (String(url).includes('/alpha/decisions'))
          return Response.json({
            answers: { paper_0: { type: 'noul', noul: 0.9 } },
          });
        expect(new URL(url).searchParams.get('filter')).toBe(
          'is_retracted:false,from_publication_date:2020-01-01',
        );
        return Response.json({ results: [work] });
      }),
    );
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
      result: { mode: 'citations', ranking: 'jev', plan: revisedPlan },
    });
  });

  it.each([{ ENABLE_AGENT: 'false' }, { OPENROUTER_API_KEY: undefined }])(
    'rejects refinements when planning is unavailable: %j',
    async (settings) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const response = await worker.fetch(
        request({ query: originalQuery, refinement, useAgent: true }),
        { ...env, ...settings },
      );
      const events = (await response.text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        message: expect.stringContaining('refinement is unavailable'),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { ...refinement, instructions: '  ' },
    { ...refinement, instructions: 'x'.repeat(501) },
    { ...refinement, history: [] },
    {
      ...refinement,
      history: Array.from({ length: MAX_SEARCH_ROUNDS }, () => history[0]),
    },
    { ...refinement, history: [{ ...history[0], plan: {} }] },
    { ...refinement, history: [{ ...history[0], retrieved: -1 }] },
    {
      ...refinement,
      history: [{ ...history[0], sampleTitles: ['x'.repeat(201)] }],
    },
  ])(
    'rejects invalid refinement context before provider calls: %j',
    async (invalidRefinement) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const response = await worker.fetch(
        request({ query: originalQuery, refinement: invalidRefinement }),
        env,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('refinement'),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('bounds the request body even when it claims to contain refinement context', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(
      request({
        query: originalQuery,
        refinement,
        extra: 'x'.repeat(512 * 1024),
      }),
      env,
    );
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('search history snapshots', () => {
  it('retains the plan and counts while limiting result samples and omitting full paper metadata', () => {
    const result = {
      ...previousResult(),
      retrieved: 80,
      papers: Array.from({ length: 40 }, () => ({
        ...paper,
        title: 't'.repeat(400),
      })),
    };
    const round = searchRound(result, earlierFeedback);
    expect(round.plan).toEqual(result.plan);
    expect(round).toMatchObject({
      instructions: earlierFeedback,
      retrieved: 80,
      returned: 40,
    });
    expect(round.sampleTitles).toEqual(
      Array.from({ length: 5 }, () => 't'.repeat(200)),
    );
    expect(JSON.stringify(round)).not.toContain('10.1234/youth');
    expect(result.papers[0].title).toHaveLength(400);
    expect(
      refinementSchema.safeParse({
        instructions: latestFeedback,
        history: [round],
      }).success,
    ).toBe(true);
  });

  it('accepts the full length of a previous keyword search in refinement history', () => {
    const longQuery = 'x'.repeat(500);
    const result = {
      ...previousResult(keywordPlan(longQuery)),
      query: longQuery,
    };
    expect(
      refinementSchema.safeParse({
        instructions: latestFeedback,
        history: [searchRound(result)],
      }).success,
    ).toBe(true);
  });
});
