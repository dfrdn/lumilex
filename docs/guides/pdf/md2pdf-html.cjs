// Renders a docs/guides markdown file to print-ready HTML in the scratchpad.
// Usage: node md2html.cjs <input.md> <output.html> [--deck]
const fs = require('fs');
const path = require('path');
// marked is not a project dependency — install transiently (`npm i --no-save
// marked`) and this resolves it from the current working directory too.
let marked;
try { ({ marked } = require('marked')); }
catch { ({ marked } = require(path.join(process.cwd(), 'node_modules', 'marked'))); }

const [, , input, output, mode] = process.argv;
const src = fs.readFileSync(input, 'utf8');
const isDeck = mode === '--deck';
const isSheet = mode === '--sheet';
const baseDir = process.argv[5] || ('file://' + path.dirname(path.resolve(input)) + '/');

marked.setOptions({ gfm: true, breaks: false });

// Pull mermaid fences out before parsing so marked doesn't escape them.
const mermaids = [];
let md = src.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
  mermaids.push(code);
  return `\n<div class="mermaid-slot" data-i="${mermaids.length - 1}"></div>\n`;
});

// Deck speaker notes -> styled blocks; slide separators -> section breaks.
if (isDeck) {
  md = md.replace(/<!--\s*notes:\s*([\s\S]*?)-->/g, (_, n) => `\n> **Speaker notes:** ${n.trim()}\n`);
  md = md.replace(/^---$/gm, '\n<hr class="slide-break">\n');
}

let html = marked.parse(md);
html = html.replace(/<div class="mermaid-slot" data-i="(\d+)"><\/div>/g,
  (_, i) => `<pre class="mermaid">${mermaids[+i].replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`);

const title = (src.match(/^#\s+(.+)$/m) || [, path.basename(input)])[1].replace(/[*_`]/g, '');

const page = `<!doctype html>
<html><head><meta charset="utf-8">
<base href="${baseDir}">
<title>${title}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.55 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
         color: #1c1917; max-width: 178mm; margin: 0 auto; }
  h1 { font-size: 21pt; line-height: 1.2; margin: 0 0 4mm; color: #292524;
       border-bottom: 2.5px solid #b45309; padding-bottom: 3mm; }
  h1 + p > strong:first-child { color: #78716c; }
  h2 { font-size: 14pt; margin: 8mm 0 3mm; color: #292524;
       border-bottom: 1px solid #d6d3d1; padding-bottom: 1.5mm; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 6mm 0 2mm; color: #44403c; break-after: avoid; }
  h4 { font-size: 10.5pt; margin: 4mm 0 1.5mm; break-after: avoid; }
  p { margin: 0 0 2.5mm; }
  ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin-bottom: 1mm; }
  a { color: #92400e; text-decoration: none; border-bottom: 1px dotted #d6b28a; }
  code { font: 8.5pt/1.4 "SF Mono", Menlo, Consolas, monospace; background: #f5f5f4;
         border: 1px solid #e7e5e4; border-radius: 3px; padding: 0.5px 3px; }
  pre code { border: 0; background: none; padding: 0; }
  pre { background: #f5f5f4; border: 1px solid #e7e5e4; border-radius: 4px;
        padding: 3mm; overflow-x: hidden; white-space: pre-wrap; break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 4mm; font-size: 9pt; break-inside: avoid; }
  th { background: #f5f5f4; text-align: left; }
  th, td { border: 1px solid #d6d3d1; padding: 1.6mm 2.5mm; vertical-align: top; }
  tr:nth-child(even) td { background: #fafaf9; }
  blockquote { margin: 3mm 0; padding: 2mm 4mm; border-left: 3px solid #d97706;
               background: #fffbeb; color: #451a03; break-inside: avoid; }
  blockquote p { margin: 0; }
  img { max-width: 100%; border: 1px solid #d6d3d1; border-radius: 4px;
        margin: 2mm 0 1mm; break-inside: avoid; }
  img + em, p > em:only-child { color: #78716c; font-size: 8.5pt; }
  .mermaid { background: #fff; border: 1px solid #e7e5e4; border-radius: 4px;
             text-align: center; padding: 3mm; break-inside: avoid; }
  .mermaid svg { max-width: 100%; height: auto; }
  hr { border: 0; border-top: 1px solid #d6d3d1; margin: 5mm 0; }
  hr.slide-break { break-after: page; border: 0; margin: 0; }
  strong { color: #292524; }
  ${isSheet ? `
  @page { margin: 9mm 10mm; }
  body { font-size: 8.4pt; line-height: 1.4; max-width: 190mm; }
  h1 { font-size: 13pt; margin-bottom: 1.5mm; padding-bottom: 1.5mm; }
  h2 { font-size: 10pt; margin: 3mm 0 1.5mm; padding-bottom: 0.8mm; }
  p { margin-bottom: 1.5mm; }
  table { font-size: 7.6pt; margin-bottom: 2mm; }
  th, td { padding: 0.9mm 1.8mm; }
  code { font-size: 7pt; padding: 0 2px; }
  ul, ol { margin-bottom: 1.5mm; }
  li { margin-bottom: 0.4mm; }
  blockquote { margin: 1.5mm 0; padding: 1mm 2.5mm; }
  ` : ''}
</style></head>
<body>
${html}
<script>
  mermaid.initialize({ startOnLoad: false, theme: 'neutral', flowchart: { useMaxWidth: true } });
  window.__MERMAID_DONE__ = false;
  mermaid.run({ querySelector: '.mermaid' }).then(() => { window.__MERMAID_DONE__ = true; })
    .catch((e) => { window.__MERMAID_DONE__ = 'error: ' + e; });
  if (!document.querySelector('.mermaid')) window.__MERMAID_DONE__ = true;
</script>
</body></html>`;

fs.writeFileSync(output, page);
console.log('wrote', output, `(${mermaids.length} diagrams)`);
