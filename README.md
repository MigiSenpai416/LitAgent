# LitAgent

Describe a research idea to generate search paths and discover papers from OpenAlex.

Searches retrieve up to 100 papers per search path in each batch and keep every unique result. Use **Load more papers** to continue through the OpenAlex cursor pages until the search paths are exhausted. There is no project cap on the total number of search results. Papers already collected stay available if loading more fails or is cancelled, and CSV export includes all currently displayed matches across loaded batches. When relevance ranking is configured, every new paper is evaluated in batches; if some batches cannot be ranked, their papers remain available and the interface distinguishes partial relevance estimates.

After a search completes, use **Refine this search** above the results to explain what is missing, add a keyword, change the scope, or correct the interpretation. Refinement reruns planning, retrieval, and the configured relevance ranking with the original idea, all previous feedback and plans, and a small sample of earlier result titles and counts. The latest feedback takes precedence when research scope changes.

Search history stays on the current page until you reload it and supports up to 20 completed searches (the original search plus 19 refinements). Using the main search box starts a new history. Failed or cancelled refinements preserve the current results and feedback so you can retry. Agent-assisted planning must be enabled and configured to refine; ordinary searches retain their keyword fallback.

Run locally with `npm run dev`. Validate changes with `npm test`, `npm run check`, and `npm run build`.
