import * as fs from 'fs';
import * as path from 'path';

/**
 * CI check for the AI gate: no model client may be constructed, and no
 * embedding call made, outside `lib/ai/gate.ts`.
 *
 * Why this exists. Every AI feature is opt-in per firm, which means the rule
 * "ask before sending this firm's content to a third party" has to hold at
 * every call site. It had no chokepoint to live in: twenty-two files each did
 * their own `new Anthropic({ apiKey })`, so the rule was a convention, and a
 * convention is what the `firm_id` stamping bug was before
 * `getServiceDbForFirm` made omitting it impossible. The gate is that
 * function; this script is what keeps it the only one.
 *
 * The check is deliberately syntactic and dumb — it looks for the SDK
 * constructor and the Voyage entry points as text. That is the whole point: it
 * cannot be argued with, and a new call site fails until somebody routes it
 * through `anthropicFor` (a firm's consent) or `anthropicForPlatform` (a
 * reason, from a closed set, why there is no firm).
 *
 * The allowlist is small and grouped by reason. A new entry is a decision to
 * write down, not a way to make the build green.
 *
 * Exits 1 on any violation, 0 otherwise. Run:
 *   npx tsx scripts/audit-ai-gate.ts
 */

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['app', 'lib', 'components', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git']);

/** The gate itself, and the leaf modules it is built from. */
const THE_GATE = new Set([
  // Constructs the clients. This is the point.
  'lib/ai/gate.ts',
  // The raw Voyage HTTP client. `lib/ai/embeddings.ts` is its only caller and
  // is where the `ai_search` check lives; this file is the transport.
  'lib/ai/voyage.ts',
]);

/**
 * Permanent exceptions, grouped by reason.
 *
 * `lib/ai/embeddings.ts` is the *only* module allowed to call Voyage directly:
 * it holds the `ai_search` check for both the read path (the query string is
 * itself firm content) and the write path (a durable derived copy). Everything
 * else goes through it.
 *
 * The maintenance scripts run from an operator's shell against an explicit
 * firm, with the service-role key already in hand — they are not a request
 * path and there is no session to consent on behalf of. They are listed rather
 * than converted because a feature check there would test the operator's own
 * intent, which the operator has already expressed by running the script.
 */
const ALLOWLIST: Record<string, readonly string[]> = {
  'holds the ai_search check': ['lib/ai/embeddings.ts'],
  'operator-run maintenance, explicit firm argument': [
    'scripts/backfill-analyses.ts',
    'scripts/generate-all-summaries.ts',
    'scripts/reembed-all-analyses.ts',
    'scripts/reembed-deliverable-versions.ts',
    'scripts/backfill-matter-briefs.ts',
    'scripts/seed-evidence-rules.ts',
  ],
};

const ALLOWED = new Set(Object.values(ALLOWLIST).flat());

interface Violation {
  file: string;
  line: number;
  text: string;
  rule: string;
}

const RULES: { rule: string; re: RegExp }[] = [
  {
    rule: 'constructs an Anthropic client outside the gate',
    re: /\bnew\s+Anthropic\s*\(/,
  },
  {
    rule: 'calls Voyage outside lib/ai/embeddings.ts',
    re: /\b(?:embedTexts|embedText|embedQuery)\s*\(/,
  },
];

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(p);
    } else if (/\.tsx?$/.test(entry.name)) {
      yield p;
    }
  }
}

function main(): void {
  const violations: Violation[] = [];
  let scanned = 0;

  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;

    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file);
      if (THE_GATE.has(rel) || ALLOWED.has(rel)) continue;
      scanned++;

      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((text, i) => {
        // An import of the SDK's *types* sends nothing anywhere.
        if (/^\s*import\s+type\b/.test(text)) return;
        // Prose that quotes the pattern is not a call site. Without this the
        // rule cannot be explained anywhere in the tree it scans — including
        // in this file, which has to state it to be readable at all.
        if (/^\s*(?:\/\/|\/\*|\*)/.test(text)) return;
        for (const { rule, re } of RULES) {
          if (re.test(text)) {
            violations.push({ file: rel, line: i + 1, text: text.trim(), rule });
          }
        }
      });
    }
  }

  if (violations.length === 0) {
    console.log(
      `✓ AI gate intact — ${scanned} files scanned, every model call routed through lib/ai/gate.ts`,
    );
    process.exit(0);
  }

  console.error(`✗ ${violations.length} AI call site(s) bypassing lib/ai/gate.ts:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.rule}`);
    console.error(`    ${v.text}\n`);
  }
  console.error(
    'Route firm content through anthropicFor({ firmId, feature }), or — when the\n' +
      'work genuinely has no firm behind it — anthropicForPlatform(reason), adding\n' +
      'the reason to PlatformAiReason in lib/ai/gate.ts.\n',
  );
  process.exit(1);
}

main();
