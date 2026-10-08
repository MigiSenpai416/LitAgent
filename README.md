# LitAgent

Describe a research idea to generate search paths and discover papers from OpenAlex.

After a search completes, use **Refine this search** above the results to explain what is missing, add a keyword, change the scope, or correct the interpretation. Refinement reruns planning, retrieval, and the configured relevance ranking with the original idea, all previous feedback and plans, and a small sample of earlier result titles and counts. The latest feedback takes precedence when research scope changes.

Search history stays on the current page until you reload it and supports up to 20 completed searches (the original search plus 19 refinements). Using the main search box starts a new history. Failed or cancelled refinements preserve the current results and feedback so you can retry. Agent-assisted planning must be enabled and configured to refine; ordinary searches retain their keyword fallback.

Run locally with `npm run dev`. Validate changes with `npm test`, `npm run check`, and `npm run build`.
