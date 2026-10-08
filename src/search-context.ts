import type { SearchResult, SearchRound } from '../shared/types';

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
