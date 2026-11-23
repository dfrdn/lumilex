import fs from 'fs/promises';
import path from 'path';

// SuperDoc's stylesheet, served as a plain file instead of imported through the
// bundler. SuperDoc 2 styles its search and proofing marks with the CSS Custom
// Highlight API (`::highlight(...)`), which Turbopack's CSS parser rejects —
// importing the file fails the whole build. Browsers parse it fine.
//
// Rendered once at build time; the root layout links it.
export const dynamic = 'force-static';

async function packageFile(relative: string): Promise<string> {
  let dir = process.cwd();
  for (;;) {
    try {
      return await fs.readFile(path.join(dir, 'node_modules', relative), 'utf8');
    } catch (err) {
      const parent = path.dirname(dir);
      if (parent === dir) throw err;
      dir = parent;
    }
  }
}

export async function GET() {
  const [engine, superdoc] = await Promise.all([
    packageFile('@superdoc/docx-engine/dist/style.css'),
    packageFile('superdoc/dist/style.css'),
  ]);
  // superdoc's file opens with `@import "@superdoc/docx-engine/style.css"`, a
  // bare package specifier a browser cannot fetch — inline it instead.
  const css = `${engine}\n${superdoc.replace(/^@import\s+["']@superdoc\/docx-engine\/style\.css["'];?\s*/m, '')}`;
  return new Response(css, {
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
