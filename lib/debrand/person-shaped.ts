// ── Person-shaped constants ──────────────────────────────────────────
//
// `verify:brand` greps for the origin firm's NAME. It therefore cannot see a
// real person encoded as INITIALS, and that is how compensation data was
// actually written in this codebase — twice, both shipped in `lib/`, both green
// under every run of that gate:
//
//   • `PARTNER_PROFIT_SHARES = { ADC: 0.40, BEL: 0.30, CMR: 0.15, ... }`
//     — one firm's partner profit shares, keyed by partner initials.
//   • `bonusProfile: 'standard' | 'qzx'` — one person's initials as an enum
//     member, selecting a different bonus band.
//
// Neither was found by a gate; both were found by reading code during an
// unrelated cut. This module is the gate. (The initials and figures quoted here
// are stand-ins in the same shape; the real ones are not published.)
//
// **It does not try to decide what is a person.** It cannot: `qzx` and `bsp`
// are the same shape, and only a human knows one is a name and the other is
// the central bank. So it is an allowlist ratchet in the shape of
// `audit-service-role.ts` — it finds every short opaque token in the two
// positions where person-shaped data actually appeared, and every one of them
// must be named below with a reason. A new one fails until somebody says what
// it is. That question ("what is `RJT`?") is the whole value.
//
// The pure half lives here so the negative controls — the two constants
// above, reconstructed — run in the unit suite. `scripts/audit-person-shaped.ts`
// is the IO around it. Same split as `evaluateFeature` / `resolveFeature`.

/** One token found in a risky position. */
export interface PersonShapeHit {
  token: string;
  line: number;
  /** Which rule matched — named so the failure message can explain itself. */
  position: 'key-to-number' | 'union-member';
  /** The source line, trimmed, for the report. */
  text: string;
}

/**
 * Object-literal key mapping to a numeric value: `ADC: 0.40`, `'BEL': 25`.
 * This is the shape a per-person allocation takes — a share, a rate, a band.
 */
const KEY_TO_NUMBER = /(?:^|[{,\s])['"]?([A-Za-z][A-Za-z0-9_]{1,3})['"]?\s*:\s*-?\d/g;

/**
 * String-union member: the `'qzx'` in `'standard' | 'qzx'`. Catches the
 * lowercase case, which an initials-shaped `^[A-Z]{2,4}$` rule would miss —
 * the reason that first-guess rule was wrong.
 *
 * Both sides of the pipe, deliberately. The first cut of this matched only a
 * token FOLLOWED by `|`, which missed `'qzx'` — the last member of its union,
 * and the actual constant this gate exists for. The colocated negative control
 * is what caught that.
 */
const UNION_BEFORE_PIPE = /['"]([A-Za-z][A-Za-z0-9_]{1,3})['"]\s*\|/g;
const UNION_AFTER_PIPE = /\|\s*['"]([A-Za-z][A-Za-z0-9_]{1,3})['"]/g;

/**
 * Every short token currently in those positions, grouped by what it is.
 *
 * Adding an entry is a claim that the token names a thing, not a person. Keep
 * the groups — an ungrouped dump is how a person's initials get appended
 * without anyone noticing, which is the failure this exists to prevent.
 */
export const ALLOWED_TOKENS: Readonly<Record<string, readonly string[]>> = {
  // Ordinary UI and code vocabulary: statuses, directions, sizes, verbs.
  vocabulary: [
    'add', 'all', 'All', 'any', 'ask', 'bad', 'both', 'case', 'chat', 'code',
    'cron', 'dark', 'date', 'days', 'desc', 'dir', 'doc', 'done', 'Done',
    'down', 'due', 'edit', 'file', 'File', 'firm', 'form', 'Free', 'full',
    'gen', 'gold', 'grid', 'high', 'High', 'hour', 'id', 'idle', 'item',
    'law', 'left', 'Left', 'line', 'list', 'logo', 'loss', 'Loss', 'low',
    'Low', 'map', 'mark', 'menu', 'mine', 'my', 'name', 'navy', 'new', 'no',
    'none', 'None', 'ok', 'only', 'open', 'or', 'page', 'paid', 'para',
    'past', 'push', 'rank', 'raw', 'read', 'red', 'risk', 'rose', 'row',
    'Rule', 'rule', 'self', 'send', 'sent', 'set', 'size', 'span', 'step', 'task',
    'Task', 'Tax', 'team', 'text', 'top', 'true', 'type', 'up', 'us', 'user',
    'User', 'warn', 'week', 'win', 'Win', 'won', 'year', 'yes', 'you', 'zoom',
    'Busy', 'Attn', 'Re', 'flex', 'for', 'in', 'sc', 'auto', 'band', 'gap', 'mode',
    'soon', 'one', 'grey', 'lg', 'div', 'li', 'href', 'blue', 'sky', 'teal', 'late', 'Fees', 'xl',
    'body', 'by', 'kind', 'owed', 'rich', 'end', 'fees', 'key', 'main', 'side', 'away', 'Home', 'End',
    'from', 'to', 'pins', 'cell',
  ],
  // Philippine agencies and legal/corporate terms of art. Same shape as
  // initials, which is exactly why they must be named rather than guessed at.
  ph_legal: ['AFS', 'amlc', 'bir', 'bsp', 'doj', 'GIS', 'ipo', 'npc', 'OPC', 'PH', 'ra', 'sec', 'sss', 'TIN'],
  // Corporate compliance obligations and IPOPHL steps, as keys: General
  // Information Sheet, audited financial statements, income tax return,
  // beneficial-ownership declaration, annual stockholders' meeting, Office
  // Action, certificate of registration.
  compliance_keys: ['gis', 'afs', 'itr', 'bo', 'asm', 'oa', 'cor'],
  // A mark's international registration under the Madrid Protocol, as a field.
  madrid_fields: ['irId'],
  // Philippine court levels (Court of Appeals, Court of Tax Appeals, Regional
  // and Municipal Trial Courts) and a motion for reconsideration.
  courts: ['ca', 'cta', 'rtc', 'mtc', 'mr'],
  // File formats, protocols, HTTP verbs, and the zip signature a .docx starts with.
  formats: ['csv', 'docx', 'html', 'jpg', 'json', 'md', 'pdf', 'png', 'POST', 'PUT', 'xlsx', 'PK'],
  // Field names in a model tool schema: the affidavit review's question number.
  schema_fields: ['q_no'],
  // Units, technical abbreviations, and generated time-slot keys (T00…T24).
  technical: ['ai', 'asc', 'cap', 'db', 'dl', 'dtr', 'eq', 'fyi', 'gte', 'lte', 'opex', 'sm', 'T00', 'T24', 'TTL', 'ytd'],
};

const ALLOWED = new Set(Object.values(ALLOWED_TOKENS).flat());

export function isAllowedToken(token: string): boolean {
  return ALLOWED.has(token);
}

/**
 * Scan one file's source for short opaque tokens in the two risky positions.
 * Allowlisted tokens are dropped here, so a caller only ever sees hits that
 * need a human answer.
 */
export function scanSource(source: string): PersonShapeHit[] {
  const hits: PersonShapeHit[] = [];
  const lines = source.split('\n');

  lines.forEach((text, i) => {
    const seen = new Set<string>();
    const collect = (re: RegExp, position: PersonShapeHit['position']) => {
      // Fresh lastIndex per line: these are module-level /g regexes.
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const token = m[1];
        if (isAllowedToken(token)) continue;
        const key = `${position}:${token}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ token, line: i + 1, position, text: text.trim() });
      }
    };
    collect(KEY_TO_NUMBER, 'key-to-number');
    collect(UNION_BEFORE_PIPE, 'union-member');
    collect(UNION_AFTER_PIPE, 'union-member');
  });

  return hits;
}
