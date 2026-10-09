import type { SearchResult, SearchRound } from '../shared/types';
import { deduplicatePapers } from '../shared/papers';

export function mergeSearchResults(
  previous: SearchResult,
  next: SearchResult,
): SearchResult {
  const papers = deduplicatePapers([...previous.papers, ...next.papers]);
  const scored = papers.filter((paper) => paper.score !== null).length;
  const ranking =
    scored === 0 ? 'openalex' : scored === papers.length ? 'jev' : 'mixed';
  if (scored) papers.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return {
    ...next,
    papers,
    retrieved: papers.length,
    queriesSearched: [
      ...new Set([...previous.queriesSearched, ...next.queriesSearched]),
    ],
    ranking,
    warnings: [...new Set([...previous.warnings, ...next.warnings])],
    elapsedMs: previous.elapsedMs + next.elapsedMs,
  };
}

export function searchRound(
  result: SearchResult,
  instructions: string | null = null,
): SearchRound {
  return {
    instructions,
    plan: result.plan,
    queriesSearched: result.queriesSearched,
    retrieved: result.retrieved,
    returned: result.papers.length,
    sampleTitles: result.papers
      .slice(0, 5)
      .map((paper) => paper.title.slice(0, 200).trim())
      .filter(Boolean),
    warnings: result.warnings
      .slice(0, 10)
      .map((warning) => warning.slice(0, 500)),
  };
}
