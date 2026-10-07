import { afterEach, expect, it, vi } from 'vitest';
import type { Paper } from '../shared/types';
import { exportPapers } from '../src/storage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('exports readable CSV while preserving DOI text and escaping quotes, newlines, and formulas', async () => {
  vi.useFakeTimers();
  const link = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('document', { createElement: vi.fn(() => link) });
  let exported: Blob | undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    exported = blob as Blob;
    return 'blob:litagent-test';
  });
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const paper: Paper = {
    id: 'https://openalex.org/W1',
    title: 'A "quoted", multi-line\nstudy',
    doi: '10.1234/chapter/a?b#c%20',
    year: 2025,
    authors: ['A. "Researcher"', 'B, Researcher'],
    venue: null,
    citations: 0,
    abstract: null,
    openAccessUrl: 'https://example.com/paper',
    pdfUrl: null,
    topics: [],
    score: null,
  };
  exportPapers([
    paper,
    {
      ...paper,
      title: '=HYPERLINK("https://example.com")',
      doi: null,
      year: null,
      authors: [],
      openAccessUrl: null,
    },
  ]);
  expect(link.download).toBe('litagent-papers.csv');
  expect(link.click).toHaveBeenCalledOnce();
  expect(exported?.type).toBe('text/csv;charset=utf-8;');
  const csv = await exported!.text();
  expect(csv).toContain('"Title","DOI","Year","Authors","Open access URL"');
  expect(csv).toContain('"A ""quoted"", multi-line\nstudy"');
  expect(csv).toContain('"10.1234/chapter/a?b#c%20"');
  expect(csv).toContain('"A. ""Researcher""; B, Researcher"');
  expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")","","","",""');
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledWith('blob:litagent-test');
});
