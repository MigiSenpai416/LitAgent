import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  Copy,
  FileText,
  GitBranch,
  Library,
  LoaderCircle,
  Search,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  Paper,
  SearchPlan,
  SearchResult,
  ServiceConfig,
} from '../shared/types';
import { getConfig, streamSearch } from './api';
import { exportPapers, readSaved } from './storage';
import { getSciHubUrl } from '../shared/papers';

const suggestions = [
  {
    category: 'EDUCATION',
    query: 'How does generative AI affect critical thinking in students?',
    terms: 'generative AI critical thinking students',
  },
  {
    category: 'ENVIRONMENT',
    query: 'Can urban green spaces improve mental health?',
    terms: 'urban green space mental health',
  },
  {
    category: 'TECHNOLOGY',
    query: 'What makes retrieval-augmented generation more reliable?',
    terms: 'retrieval augmented generation reliability',
  },
];

function externalUrl(value: string | null): string | undefined {
  try {
    const url = new URL(value || '');
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function ConceptMap({
  plan,
  compact = false,
}: {
  plan: SearchPlan;
  compact?: boolean;
}) {
  return (
    <section
      className={`concept-panel ${compact ? 'compact' : ''}`}
      aria-label="Research concept map"
    >
      <div className="panel-heading">
        <span>
          <GitBranch size={15} /> YOUR RESEARCH, MAPPED
        </span>
        <span className="small-tag">
          {plan.source === 'agent'
            ? 'Agent interpretation'
            : 'Original keywords'}
        </span>
      </div>
      <h3>{plan.question}</h3>
      <div className="concepts">
        {plan.concepts.map((concept, index) => (
          <div className="concept" key={`${concept.label}-${index}`}>
            <span className="concept-dot" />
            <strong>{concept.label}</strong>
            <p>{concept.description}</p>
          </div>
        ))}
      </div>
      <div className="search-queries">
        <span>Search paths</span>
        {plan.queries.map((query) => (
          <code key={query}>{query}</code>
        ))}
      </div>
    </section>
  );
}

function PaperCard({
  paper,
  index,
  fulltext,
  sciHubEnabled,
  saved,
  onSave,
  onNotify,
}: {
  paper: Paper;
  index: number;
  fulltext: boolean;
  sciHubEnabled: boolean;
  saved: boolean;
  onSave: () => void;
  onNotify: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const oaUrl = externalUrl(paper.openAccessUrl);
  const doiUrl = paper.doi ? `https://doi.org/${paper.doi}` : undefined;
  const sciHubLink =
    sciHubEnabled && getSciHubUrl(paper.doi)
      ? `/api/paper/scihub?doi=${encodeURIComponent(paper.doi!)}`
      : null;
  async function copyDoi() {
    try {
      await navigator.clipboard.writeText(paper.doi!);
      onNotify('DOI copied to clipboard');
    } catch {
      onNotify('Could not copy. Select the DOI to copy it manually.');
    }
  }
  return (
    <article className="paper-card">
      <span className="paper-number">{String(index + 1).padStart(2, '0')}</span>
      <div className="paper-content">
        <div className="paper-meta">
          <span>{paper.year || 'Year unavailable'}</span>
          <span className="meta-dot">·</span>
          <span>{paper.venue || 'Source unavailable'}</span>
          {oaUrl && <span className="oa-tag">Open access</span>}
          {paper.score !== null && (
            <span className="score-tag">
              {Math.round(paper.score * 100)}% relevance estimate
            </span>
          )}
        </div>
        <h3>
          <a
            href={doiUrl || externalUrl(paper.id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {paper.title}
          </a>
        </h3>
        <p className="authors">
          {paper.authors.slice(0, 3).join(', ') || 'Authors unavailable'}
          {paper.authors.length > 3 ? ` +${paper.authors.length - 3} more` : ''}
        </p>
        {fulltext && paper.abstract && (
          <p className={`abstract ${expanded ? 'expanded' : ''}`}>
            {paper.abstract}
          </p>
        )}
        {fulltext && !paper.abstract && (
          <p className="abstract missing">
            No abstract is available in OpenAlex.
          </p>
        )}
        {fulltext && paper.abstract && paper.abstract.length > 260 && (
          <button
            className="text-button abstract-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Less' : 'Read abstract'}{' '}
            <ChevronDown size={13} className={expanded ? 'rotated' : ''} />
          </button>
        )}
        <div className="paper-bottom">
          <div className="doi-line">
            <span>DOI</span>
            {paper.doi ? (
              <>
                <a href={doiUrl} target="_blank" rel="noopener noreferrer">
                  {paper.doi}
                </a>
                <button
                  className="icon-button"
                  aria-label={`Copy DOI for ${paper.title}`}
                  onClick={() => void copyDoi()}
                >
                  <Copy size={13} />
                </button>
              </>
            ) : (
              <span className="missing">Not assigned</span>
            )}
          </div>
          <span className="citation-count">
            {paper.citations.toLocaleString()} citations
          </span>
        </div>
        <div className="paper-links">
          {fulltext && oaUrl && (
            <a
              className="read-paper"
              href={oaUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <BookOpen size={14} />{' '}
              {paper.pdfUrl ? 'Read paper' : 'View open-access source'}{' '}
              <ArrowUpRight size={14} />
            </a>
          )}
          {sciHubLink && (
            <a
              className="read-paper"
              href={sciHubLink}
              target="_blank"
              rel="noopener noreferrer"
              title="Look up this DOI on www.sci-hub.in; availability is not verified"
            >
              <FileText size={14} /> Try Sci-Hub <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      </div>
      <button
        className={`icon-button save-button ${saved ? 'is-saved' : ''}`}
        aria-label={`${saved ? 'Unsave' : 'Save'} ${paper.title}`}
        aria-pressed={saved}
        onClick={onSave}
      >
        <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
      </button>
    </article>
  );
}

export default function App() {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'citations' | 'fulltext'>('citations');
  const [useAgent, setUseAgent] = useState(true);
  const [useDecisions, setUseDecisions] = useState(false);
  const [fromYear, setFromYear] = useState('');
  const [config, setConfig] = useState<ServiceConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [settings, setSettings] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [plan, setPlan] = useState<SearchPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'discover' | 'saved'>('discover');
  const [saved, setSaved] = useState(readSaved);
  const [sort, setSort] = useState('relevance');
  const [closeOnly, setCloseOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    getConfig(abort.signal)
      .then(setConfig)
      .catch(() => {
        if (!abort.signal.aborted) setConfigError(true);
      });
    return () => {
      abort.abort();
      controller.current?.abort();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  function notify(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 3500);
  }

  function toggleSaved(paper: Paper) {
    const next = saved.some((item) => item.id === paper.id)
      ? saved.filter((item) => item.id !== paper.id)
      : [paper, ...saved].slice(0, 200);
    try {
      localStorage.setItem('litagent.saved', JSON.stringify(next));
      setSaved(next);
    } catch {
      notify(
        'Browser storage is full or unavailable. This paper could not be saved.',
      );
    }
  }

  async function runSearch(value = query) {
    if (busy) return;
    if (value.trim().length < 3) {
      setError('Describe your topic in at least 3 characters.');
      searchRef.current?.focus();
      return;
    }
    if (config?.accessProtected && !accessToken.trim()) {
      setSettings(true);
      setError('Enter your deployment access token in Search settings.');
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setQuery(value);
    setBusy(true);
    setError('');
    setResult(null);
    setPlan(null);
    setTab('discover');
    setCloseOnly(false);
    setSort('relevance');
    try {
      await streamSearch(
        {
          query: value,
          mode,
          useAgent,
          useDecisions,
          fromYear: fromYear ? Number(fromYear) : null,
        },
        accessToken.trim(),
        abort.signal,
        (event) => {
          if (event.type === 'phase') setPhase(event.message);
          if (event.type === 'plan') setPlan(event.plan);
          if (event.type === 'result') setResult(event.result);
        },
      );
    } catch (err) {
      if (!abort.signal.aborted)
        setError(
          err instanceof Error
            ? err.message
            : 'Search failed. Please try again.',
        );
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy(false);
        setPhase('');
      }
    }
  }

  function cancelSearch() {
    controller.current?.abort();
    setPlan(null);
  }
  const papers = tab === 'saved' ? saved : result?.papers || [];
  const visible = papers
    .filter(
      (paper) =>
        tab === 'saved' ||
        !closeOnly ||
        (paper.score !== null && paper.score >= 0.7),
    )
    .sort((a, b) =>
      sort === 'year'
        ? (b.year || 0) - (a.year || 0)
        : sort === 'citations'
          ? b.citations - a.citations
          : 0,
    );
  const fulltext = tab === 'saved' || result?.mode === 'fulltext';
  const hasResults = tab === 'saved' || result !== null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="LitAgent home">
          <span className="brand-symbol">
            <span /> <span />
          </span>
          LitAgent<span className="beta-tag">BETA</span>
        </a>
        <nav aria-label="Main navigation">
          <button
            className={tab === 'discover' ? 'nav-active' : ''}
            onClick={() => setTab('discover')}
          >
            <Search size={15} /> Discover
          </button>
          <button
            className={tab === 'saved' ? 'nav-active' : ''}
            onClick={() => setTab('saved')}
          >
            <Bookmark size={15} /> My library{' '}
            {saved.length > 0 && (
              <span className="nav-count">{saved.length}</span>
            )}
          </button>
        </nav>
        <button
          className={`settings-button ${settings ? 'active' : ''}`}
          onClick={() => setSettings(!settings)}
          aria-expanded={settings}
          aria-label="Search settings"
        >
          <Settings2 size={17} />
          <span>Search settings</span>
        </button>
      </header>

      <main>
        {tab === 'discover' && (
          <>
            <section
              className={`hero ${hasResults || busy ? 'hero-small' : ''}`}
            >
              <div className="eyebrow">
                <span className="status-dot" /> A LITTLE CURIOSITY. A WORLD OF
                RESEARCH.
              </div>
              <h1>
                Follow your <span>curiosity.</span>
              </h1>
              <p className="hero-description">
                From a spark of an idea to the papers that matter.
                <br />
                Your research journey starts with a question.
              </p>
              <form
                className="search-box"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runSearch();
                }}
              >
                <label htmlFor="research-query" className="sr-only">
                  Your research idea or keywords
                </label>
                <div className="search-input-row">
                  <Search size={23} strokeWidth={1.5} />
                  <textarea
                    id="research-query"
                    ref={searchRef}
                    rows={2}
                    maxLength={500}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="What are you curious about? Try an idea, a topic, or a question…"
                    disabled={busy}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        void runSearch();
                      }
                    }}
                  />
                </div>
                <div className="search-box-bottom">
                  <div className="mode-toggle" aria-label="Search mode">
                    <button
                      type="button"
                      disabled={busy}
                      className={mode === 'citations' ? 'selected' : ''}
                      onClick={() => setMode('citations')}
                      aria-pressed={mode === 'citations'}
                    >
                      <FileText size={14} /> Title & DOI
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className={mode === 'fulltext' ? 'selected' : ''}
                      onClick={() => setMode('fulltext')}
                      aria-pressed={mode === 'fulltext'}
                    >
                      <BookOpen size={14} /> Read papers
                    </button>
                  </div>
                  {busy ? (
                    <button
                      type="button"
                      className="search-submit cancel"
                      onClick={cancelSearch}
                    >
                      Cancel <X size={16} />
                    </button>
                  ) : (
                    <button className="search-submit" type="submit">
                      Explore <ArrowRight size={17} />
                    </button>
                  )}
                </div>
              </form>
              <div className="search-caption">
                <span>
                  <Sparkles size={12} />{' '}
                  {useAgent && config?.agent
                    ? 'Agent-assisted discovery'
                    : 'OpenAlex keyword search'}
                </span>
                <span className="caption-divider" />
                <span>
                  {mode === 'fulltext'
                    ? config?.sciHubEnabled
                      ? 'Open access & Sci-Hub lookups'
                      : 'Public open-access papers'
                    : 'Real papers. Traceable sources.'}
                </span>
              </div>
            </section>
          </>
        )}

        {settings && (
          <section className="settings-panel" aria-label="Search settings">
            <div className="settings-title">
              <h2>Make it your search</h2>
              <button
                className="icon-button"
                aria-label="Close settings"
                onClick={() => setSettings(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="settings-grid">
              <label className="option-label">
                <input
                  type="checkbox"
                  checked={useAgent}
                  disabled={busy}
                  onChange={(event) => setUseAgent(event.target.checked)}
                />
                <span>
                  <strong>Understand my idea</strong>
                  <small>Map concepts and expand queries with the agent.</small>
                </span>
              </label>
              <label className="option-label">
                <input
                  type="checkbox"
                  checked={useDecisions}
                  disabled={busy}
                  onChange={(event) => setUseDecisions(event.target.checked)}
                />
                <span>
                  <strong>Check relevance with Jev</strong>
                  <small>
                    Score title and abstract matches; filter after searching.
                  </small>
                </span>
              </label>
              <label className="year-select">
                Published since
                <select
                  disabled={busy}
                  value={fromYear}
                  onChange={(event) => setFromYear(event.target.value)}
                >
                  <option value="">Any time</option>
                  {[
                    ...new Set([
                      new Date().getFullYear(),
                      2025,
                      2020,
                      2015,
                      2010,
                      2000,
                    ]),
                  ].map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {config && (
              <p className="config-note">
                {config.agent
                  ? `Agent: ${config.model} · Decisions: ${config.decisionModel}`
                  : 'Add an OpenRouter key to the Worker environment to enable the agent and Jev. Keyword search is available now.'}
              </p>
            )}
            {config?.accessProtected && (
              <label className="token-label">
                Deployment access token
                <input
                  type="password"
                  autoComplete="off"
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                  placeholder="Access token"
                />
              </label>
            )}
          </section>
        )}

        {configError && (
          <div className="message warning">
            The search service could not be reached. Make sure the Worker is
            running, then refresh.
          </div>
        )}
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        {busy && (
          <div className="progress" role="status">
            <LoaderCircle size={18} className="spinning" />
            <span>{phase || 'Starting your search…'}</span>
            <span className="progress-note">Following the evidence</span>
          </div>
        )}
        {tab === 'discover' && plan && (
          <ConceptMap plan={plan} compact={hasResults} />
        )}
        {tab === 'discover' &&
          result?.warnings.map((warning) => (
            <div key={warning} className="message warning">
              {warning}
            </div>
          ))}

        {hasResults && (
          <section className="results-section">
            <div className="results-heading">
              <div>
                {tab === 'saved' ? (
                  <>
                    <div className="eyebrow">YOUR PERSONAL READING ROOM</div>
                    <h2>
                      My library<span>{saved.length}</span>
                    </h2>
                    <p>Saved on this browser, ready when you are.</p>
                  </>
                ) : (
                  <>
                    <div className="eyebrow">FOLLOW THE EVIDENCE</div>
                    <h2>
                      Related literature<span>{visible.length}</span>
                    </h2>
                    <p>
                      {result!.retrieved} unique papers retrieved ·{' '}
                      {result!.ranking === 'jev'
                        ? 'Jev relevance order'
                        : 'OpenAlex order across search paths'}{' '}
                      · {(result!.elapsedMs / 1000).toFixed(1)}s
                    </p>
                  </>
                )}
              </div>
              <button
                className="export-button"
                disabled={!visible.length}
                onClick={() => exportPapers(visible)}
              >
                <ArrowDownToLine size={14} /> Export CSV
              </button>
            </div>
            <div className="results-toolbar">
              <div>
                {tab === 'discover' && result?.ranking === 'jev' ? (
                  <label className="close-filter">
                    <input
                      type="checkbox"
                      checked={closeOnly}
                      onChange={(event) => setCloseOnly(event.target.checked)}
                    />{' '}
                    Close matches only <span>≥70%</span>
                  </label>
                ) : (
                  <span className="toolbar-label">
                    {tab === 'saved'
                      ? 'Your saved papers'
                      : result?.mode === 'fulltext'
                        ? config?.sciHubEnabled
                          ? 'Open-access links and DOI lookups'
                          : 'Open-access sources available'
                        : 'Full titles and DOI links'}
                  </span>
                )}
              </div>
              <label>
                Sort by
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="relevance">
                    {tab === 'saved' ? 'Recently saved' : 'Search relevance'}
                  </option>
                  <option value="year">Newest first</option>
                  <option value="citations">Most cited</option>
                </select>
              </label>
            </div>
            {visible.length ? (
              <div className="paper-list">
                {visible.map((paper, index) => (
                  <PaperCard
                    key={paper.id}
                    paper={paper}
                    index={index}
                    fulltext={fulltext}
                    sciHubEnabled={config?.sciHubEnabled === true}
                    saved={saved.some((item) => item.id === paper.id)}
                    onSave={() => toggleSaved(paper)}
                    onNotify={notify}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <Library size={30} strokeWidth={1.3} />
                <h3>
                  {tab === 'saved'
                    ? 'A home for your next discovery.'
                    : closeOnly
                      ? 'No close matches in this set.'
                      : 'No papers found along these paths.'}
                </h3>
                <p>
                  {tab === 'saved'
                    ? 'Bookmark a paper to keep it here for later.'
                    : closeOnly
                      ? 'Turn off the relevance filter to explore the full set.'
                      : 'Try fewer keywords, broaden the year range, or switch to Title & DOI.'}
                </p>
                {tab === 'saved' && (
                  <button
                    className="text-button"
                    onClick={() => setTab('discover')}
                  >
                    Discover papers <ArrowRight size={15} />
                  </button>
                )}
              </div>
            )}
            {result?.ranking === 'jev' && tab === 'discover' && (
              <p className="evidence-note">
                Relevance scores estimate a match to your question from
                metadata. They do not assess study quality or verify findings.
                The 70% filter is a starting point.
              </p>
            )}
          </section>
        )}

        {!busy && !hasResults && tab === 'discover' && (
          <>
            <section className="suggestions">
              <div className="section-label">
                <span>A PLACE TO START</span>
                <span>Big questions, small first steps.</span>
              </div>
              <div className="suggestion-grid">
                {suggestions.map((suggestion, index) => (
                  <button
                    className="suggestion-card"
                    key={suggestion.category}
                    onClick={() => {
                      setQuery(
                        config?.agent && useAgent
                          ? suggestion.query
                          : suggestion.terms,
                      );
                      searchRef.current?.focus();
                    }}
                  >
                    <span className="suggestion-top">
                      <span>{suggestion.category}</span>
                      <span className="suggestion-icon">
                        {index === 0 ? (
                          <BookOpen size={17} />
                        ) : index === 1 ? (
                          <GitBranch size={17} />
                        ) : (
                          <Sparkles size={17} />
                        )}
                      </span>
                    </span>
                    <span className="suggestion-query">{suggestion.query}</span>
                    <span className="suggestion-bottom">
                      Explore this idea <ArrowUpRight size={15} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="how-it-works">
              <div>
                <span className="step-number">01</span>
                <h3>Bring an idea</h3>
                <p>
                  No perfect keywords needed.
                  <br />
                  Start with what you want to know.
                </p>
              </div>
              <span className="step-connector" />
              <div>
                <span className="step-number">02</span>
                <h3>Connect the concepts</h3>
                <p>
                  The agent maps your question
                  <br />
                  and finds paths into the literature.
                </p>
              </div>
              <span className="step-connector" />
              <div>
                <span className="step-number">03</span>
                <h3>Find your evidence</h3>
                <p>
                  Discover related studies, follow
                  <br />
                  DOIs, and read open-access papers.
                </p>
              </div>
            </section>
          </>
        )}
      </main>
      <footer>
        <span className="footer-brand">
          LitAgent <span>Built for curious minds.</span>
        </span>
        <span>
          Research from{' '}
          <a
            href="https://openalex.org"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenAlex <ArrowUpRight size={11} />
          </a>
          <span className="footer-separator">/</span>AI via{' '}
          <a
            href="https://openrouter.ai"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenRouter <ArrowUpRight size={11} />
          </a>
        </span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
    </div>
  );
}
