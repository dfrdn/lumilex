# PDF renders

Print-ready A4 renders of every guide (`guide-*.pdf`), cheatsheet (`cheatsheet-*.pdf`, one page each), and deck (`deck-*.pdf`, one slide per page with speaker notes inlined), plus the index. They are generated from the Markdown sources — **edit the Markdown, then regenerate; never edit a PDF**.

## Regenerating

1. `npm i --no-save marked` (not a project dependency — installed transiently).
2. Serve `docs/guides/` statically (`python3 -m http.server 8899` from that directory).
3. For each source file: `node docs/guides/pdf/md2pdf-html.cjs <src.md> <tmp.html> [--deck|--sheet] <base-url>` — `--sheet` for cheatsheets (compact one-page style), `--deck` for decks (slide breaks + speaker notes).
4. Open the HTML in a headless Chromium and print to PDF (A4) — but only after **all three** gates pass:
   - `window.__MERMAID_DONE__ === true` (diagrams render client-side via the mermaid CDN);
   - `[...document.images].every(i => i.complete)` **and** no image has `naturalWidth === 0` — otherwise screenshots print as broken icons;
   - `document.title` matches the source document — a cached page prints silently otherwise.

The gstack browse daemon's `goto` + `pdf` commands do step 4 in two calls, with the gates checked via its `js` command between them. Always pass the base URL argument (4th arg) — without it the script falls back to `file://` paths, which headless browsers block for images.
