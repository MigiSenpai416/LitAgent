import type { Paper } from '../shared/types';

export function readSaved(): Paper[] {
  try {
    const data: unknown = JSON.parse(
      localStorage.getItem('litagent.saved') || '[]',
    );
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (paper): paper is Paper =>
          paper &&
          typeof paper === 'object' &&
          typeof paper.id === 'string' &&
          typeof paper.title === 'string' &&
          Array.isArray(paper.authors) &&
          Array.isArray(paper.topics),
      )
      .slice(0, 200);
  } catch {
    return [];
  }
}

export function exportPapers(papers: Paper[]): void {
  const rows = [
    ['Title', 'DOI', 'Year', 'Authors', 'Open access URL'],
    ...papers.map((paper) => [
      paper.title,
      paper.doi || '',
      String(paper.year || ''),
      paper.authors.join('; '),
      paper.openAccessUrl || '',
    ]),
  ];
  const csv = rows
    .map((row) =>
      row
        .map(
          (cell) =>
            `"${(/^[=+@\-\t\r]/.test(cell) ? `'${cell}` : cell).replaceAll('"', '""')}"`,
        )
        .join(','),
    )
    .join('\r\n');
  const url = URL.createObjectURL(
    new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'litagent-papers.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
