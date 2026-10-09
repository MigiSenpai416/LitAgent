import type { Paper } from './types';

export function deduplicatePapers(papers: Paper[]): Paper[] {
  const unique = new Map<string, Paper>();
  const doiIds = new Map<string, string>();
  for (const paper of papers) {
    const existing =
      unique.get(paper.id) ||
      (paper.doi
        ? unique.get(doiIds.get(paper.doi.toLowerCase()) || '')
        : undefined);
    if (existing) {
      if (existing.score === null && paper.score !== null)
        unique.set(existing.id, { ...existing, score: paper.score });
      continue;
    }
    unique.set(paper.id, paper);
    if (paper.doi) doiIds.set(paper.doi.toLowerCase(), paper.id);
  }
  return [...unique.values()];
}

function getDoiPath(doi: string | null): string | null {
  if (!doi || !/^10\.\d{4,9}\/\S+$/i.test(doi) || doi.length > 500) return null;
  const segments = doi.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..'))
    return null;
  try {
    return segments.map(encodeURIComponent).join('/');
  } catch {
    return null;
  }
}

export function getDoiUrl(doi: string | null): string | null {
  const path = getDoiPath(doi);
  return path ? `https://doi.org/${path}` : null;
}

export function getSciHubUrl(doi: string | null): string | null {
  const path = getDoiPath(doi);
  return path ? `https://www.sci-hub.in/${path}` : null;
}
