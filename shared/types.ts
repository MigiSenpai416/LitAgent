export interface SearchPlan {
  question: string;
  concepts: { label: string; description: string }[];
  queries: string[];
  source: 'agent' | 'keywords';
}

export const MAX_SEARCH_ROUNDS = 20;

export interface SearchRound {
  instructions: string | null;
  plan: SearchPlan;
  queriesSearched: string[];
  retrieved: number;
  returned: number;
  sampleTitles: string[];
  warnings: string[];
}

export interface SearchRefinement {
  instructions: string;
  history: SearchRound[];
}

export interface SearchRequest {
  query: string;
  refinement?: SearchRefinement;
  pagination?: SearchPagination;
}

export interface SearchPagination {
  plan: SearchPlan;
  paths: { query: string; cursor: string }[];
}

export interface Paper {
  id: string;
  title: string;
  doi: string | null;
  year: number | null;
  authors: string[];
  venue: string | null;
  citations: number;
  abstract: string | null;
  openAccessUrl: string | null;
  pdfUrl: string | null;
  topics: string[];
  score: number | null;
}

export interface SearchResult {
  query: string;
  mode: 'citations' | 'fulltext';
  plan: SearchPlan;
  papers: Paper[];
  retrieved: number;
  queriesSearched: string[];
  ranking: 'jev' | 'openalex' | 'mixed';
  warnings: string[];
  elapsedMs: number;
  pagination?: SearchPagination | null;
}

export type SearchEvent =
  | {
      type: 'phase';
      phase: 'planning' | 'searching' | 'ranking';
      message: string;
    }
  | { type: 'plan'; plan: SearchPlan }
  | { type: 'result'; result: SearchResult }
  | { type: 'error'; message: string };

export interface ServiceConfig {
  agent: boolean;
  model: string;
  decisionModel: string;
  openalexKey: boolean;
  accessProtected: boolean;
  sciHubEnabled: boolean;
}
