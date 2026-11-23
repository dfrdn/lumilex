import fs from 'fs';
import path from 'path';
import type { NextConfig } from "next";
import { RETIRED_ROUTES } from './lib/nav/retired-routes';

// Resolve the directory that actually holds the installed dependencies. In a
// normal checkout that's this folder; inside a git worktree (which has no
// node_modules of its own) it's the nearest ancestor that does. Turbopack's
// root must contain node_modules, or it panics ("symlink/package points out of
// the filesystem root") and the dev server won't boot.
function resolveDepsRoot(start: string): string {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'node_modules', 'next'))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfkit'],
  // Old URLs of renamed or retired pages (lib/nav/retired-routes.ts).
  async redirects() {
    return RETIRED_ROUTES.map((r) => ({ ...r, permanent: true }));
  },
  // A firm's logo and monogram come from its own storage prefix at render time,
  // but a bundled font set is read off disk with fs (pdfkit is external, so Next
  // can't trace the reads). Without this pin the faces are absent from the
  // serverless function and registerFonts throws. Every route that renders a
  // branded document needs it, not just the firm profile.
  //
  // These globs are deliberately wider than the handlers that actually render
  // (18 of them reach lib/pdf/fonts.ts today; app/api/finance/** alone matches
  // 52). That was free while every set used the core PDF fonts and this
  // directory held nothing but a README. Now `standard` bundles ~3.1 MB of
  // Cormorant and EB Garamond, so each matched handler carries a copy — narrow
  // a glob only against a fresh list of what imports the registry, because the
  // failure mode of getting it wrong is a client-facing export throwing in
  // production, not a build error.
  outputFileTracingIncludes: {
    'app/api/firm-profile/**': ['./public/fonts/**'],
    'app/api/fee-schedule/**': ['./public/fonts/**'],
    'app/api/proposals/**': ['./public/fonts/**'],
    // Generating an invoice lays the billing letter on the letterhead built into
    // the bundled template, read from disk at request time.
    'app/api/finance/**': ['./public/fonts/**', './lib/docx/template.docx'],
    // A trademark client report is laid on the same letterhead.
    'app/api/trademark/**': ['./public/fonts/**', './lib/docx/template.docx'],
    'app/api/status-report/**': ['./public/fonts/**'],
    'app/api/matters/**': ['./public/fonts/**'],
    'app/api/drafting/**': ['./public/fonts/**'],
    'app/api/templates/**': ['./public/fonts/**'],
    'app/api/firm-calendar/**': ['./public/fonts/**'],
    // The SEC GIS template is read from disk at request time.
    'app/api/corporation/**': ['./public/forms/**'],
  },
  // Pin Turbopack's root to the directory that holds node_modules so module
  // resolution uses the canonical dependency set. Without an explicit root,
  // Next infers it from the nearest lockfile and may resolve from a sibling
  // git worktree with an older dependency set.
  turbopack: {
    root: resolveDepsRoot(__dirname),
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: {
      bodySizeLimit: '25mb',
    },
    // Turbopack's dev filesystem cache (turbo-tasks-backend, .next/**/*.sst) has
    // been corrupting on incremental rebuilds of this project — emitting garbled
    // globals.css (null-byte tokens → "Parsing CSS source code failed") and, when
    // its files are removed under a live server, hard panics. Disabling the dev
    // persistent cache makes HMR recompile in-memory and clears it up. Cold-start
    // is a bit slower; the production build cache (…ForBuild) is left untouched.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
