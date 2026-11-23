import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { TENANT_TABLES } from '../lib/tenancy/tables.generated';

/**
 * CI check for firm_id stamping on tenant-table writes.
 *
 * Every tenant table carries `firm_id uuid NOT NULL` and — since
 * `20260823_drop_transitional_firm_defaults.sql` — no column default.
 * `getServiceDbForFirm(firmId)` stamps `firm_id` onto every insert/upsert row
 * for you. `getSupabaseServerAuthClient()` does NOT: it is the plain
 * PostgREST client carrying the user's JWT, and an insert that omits firm_id
 * fails at runtime with 23502, or 42501 when the RLS `with_check` clause
 * (`firm_id = current_firm_id()`) is evaluated against a NULL first. Both are
 * 500s on a create flow — "the + Add button is broken".
 *
 * That bug shipped four separate times after the defaults were dropped
 * (`reconcileExpectedPairs`, the `notify_new_deliverable` trigger,
 * `/api/admin/[entity]` POST, and `createDeadlineChain`), so this is the
 * ratchet rather than another sweep.
 *
 * ── How a site is judged ────────────────────────────────────────────
 *
 * For every `<expr>.from(<table>).insert|upsert(<rows>)` under app/ and lib/,
 * the script resolves TWO things from the AST:
 *
 *   1. the CLIENT — by resolving `<expr>` back to what produced it:
 *      `getSupabaseServerAuthClient()` → authed, `getServiceDbForFirm()` →
 *      scoped, `getSupabase()` → raw. Resolution follows scopes (a file can
 *      hold both clients — that IS the dual-client pattern), the fan-out
 *      callbacks' `{ db }`, and function parameters back to every caller in
 *      the tree, keyed on the defining module so same-named helpers stay
 *      distinct.
 *   2. whether the row carries an explicit `firm_id` — following identifiers
 *      to their declaration (the `/api/admin/[entity]` case had `row`
 *      assembled ~170 lines above its insert), later `row.firm_id = …`
 *      assignments, `rows.push({…})`, object spreads, array elements and
 *      `.map()` callbacks.
 *
 * A row that carries firm_id is safe under any client, so those pass
 * regardless. Otherwise:
 *
 *   - scoped  → pass (the facade stamps it).
 *   - authed  → VIOLATION. This is the bug class; fix the insert.
 *   - raw     → VIOLATION. The raw service-role client stamps nothing either.
 *   - unknown → UNRESOLVED. Requires an ALLOWLIST entry naming why.
 *
 * Precision is the point: a gate with false positives gets ignored, so a site
 * that cannot be resolved is reported for a human to triage rather than
 * warned about forever. As of the sweep that added this check, every one of
 * the 208 writes resolves and the allowlist is empty.
 *
 * Out of scope: scripts/ (dev-run, and the seed-script gap is tracked in
 * CLAUDE.md → Scripts), migrations (SQL triggers that insert must stamp
 * firm_id themselves — see 20260824_notify_new_deliverable_firm_id.sql), and
 * updates/deletes (a missing firm_id there is a scoping bug, which
 * scripts/rls-probe.ts covers, not a NOT NULL violation).
 *
 * Usage:
 *   npx tsx scripts/audit-firm-id-stamping.ts
 *   npx tsx scripts/audit-firm-id-stamping.ts --list   # every site + verdict
 *
 * Exits 1 on any violation or any un-allowlisted unresolved site.
 */

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['app', 'lib'];

// ── Allowlist ──────────────────────────────────────────────────────
//
// Keyed `<file>:<line>:<table>:<op>`. An entry means "this site was read by a
// human and does not need an explicit firm_id" — one line saying why, in the
// style of KNOWN_SHARED_PATHS in scripts/storage-probe.ts. Line numbers are
// part of the key on purpose: an edit that moves the call re-opens the
// question rather than inheriting a stale verdict.
//
// This list should only ever shrink. A new unstamped write is a bug to fix,
// not an entry to add.

const ALLOWLIST: Record<string, string> = {};

// ── Client resolution ──────────────────────────────────────────────

type ClientKind = 'authed' | 'scoped' | 'raw' | 'unknown';

const CLIENT_FACTORIES: Record<string, ClientKind> = {
  getSupabaseServerAuthClient: 'authed',
  getServiceDbForFirm: 'scoped',
  getSupabase: 'raw',
  // Browser client: never used for tenant inserts, but resolve it rather than
  // letting it fall through to unknown and land on the unresolved list.
  getSupabaseBrowserAuthClient: 'authed',
};

function unwrap(node: ts.Expression): ts.Expression {
  let cur = node;
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) cur = cur.expression;
    else if (ts.isAwaitExpression(cur)) cur = cur.expression;
    else if (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression;
    else if (ts.isNonNullExpression(cur)) cur = cur.expression;
    else return cur;
  }
}

/**
 * Binding resolution is scope-aware, because the files this check exists for
 * are exactly the ones that hold two clients at once: the dual-client pattern
 * (authed for the ownership read, firm-scoped service-role for the privileged
 * write) binds `supabase` twice in one file, and a file-global name→value map
 * would collapse both handlers into "ambiguous" and report a site the reader
 * can plainly resolve.
 *
 * Each name is resolved from the use site outwards through the enclosing
 * scopes, nearest declaration first — the same rule the language uses.
 * Reassignment (`db = …` after the declaration) is folded in conservatively:
 * every value the name is ever given must agree, or it resolves to unknown.
 */
type Bindings = {
  /** scope node → name → initializers declared directly in that scope */
  scopes: Map<ts.Node, Map<string, ts.Expression[]>>;
  /** names that are reassigned anywhere in the file → the assigned values */
  reassigned: Map<string, ts.Expression[]>;
};

function isScope(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isCaseBlock(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

function enclosingScope(node: ts.Node): ts.Node | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur && !isScope(cur)) cur = cur.parent;
  return cur;
}

function collectBindings(source: ts.SourceFile): Bindings {
  const scopes = new Map<ts.Node, Map<string, ts.Expression[]>>();
  const reassigned = new Map<string, ts.Expression[]>();
  const push = (map: Map<string, ts.Expression[]>, name: string, expr: ts.Expression) => {
    const list = map.get(name);
    if (list) list.push(expr);
    else map.set(name, [expr]);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const scope = enclosingScope(node) ?? source;
      let map = scopes.get(scope);
      if (!map) scopes.set(scope, (map = new Map()));
      push(map, node.name.text, node.initializer);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      push(reassigned, node.left.text, node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { scopes, reassigned };
}

/** Initializers for `name` as visible from `at`, nearest scope first. */
function lookup(name: string, at: ts.Node, bindings: Bindings): ts.Expression[] | null {
  let scope: ts.Node | undefined = isScope(at) ? at : enclosingScope(at);
  while (scope) {
    const found = bindings.scopes.get(scope)?.get(name);
    if (found) {
      const later = bindings.reassigned.get(name);
      return later ? [...found, ...later] : found;
    }
    scope = enclosingScope(scope);
  }
  return null;
}

function clientKindOf(
  expr: ts.Expression,
  scope: Scope,
  seen = new Set<string>(),
): ClientKind {
  const node = unwrap(expr);

  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : null;
    if (name && name in CLIENT_FACTORIES) return CLIENT_FACTORIES[name];
    return 'unknown';
  }

  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return 'unknown';
    seen.add(node.text);
    const inits = lookup(node.text, node, scope.bindings);
    if (!inits || inits.length === 0) {
      return callbackContractKind(node) ?? parameterKind(node, scope);
    }
    const kinds = new Set(inits.map((i) => clientKindOf(i, scope, seen)));
    // A name bound to two different clients (or reassigned) is not resolvable.
    return kinds.size === 1 ? [...kinds][0] : 'unknown';
  }

  if (ts.isConditionalExpression(node)) {
    const a = clientKindOf(node.whenTrue, scope, seen);
    const b = clientKindOf(node.whenFalse, scope, seen);
    return a === b ? a : 'unknown';
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const a = clientKindOf(node.left, scope, seen);
    const b = clientKindOf(node.right, scope, seen);
    return a === b ? a : 'unknown';
  }

  return 'unknown';
}

// ── Parameters: which client do a helper's callers hand it? ────────
//
// Most writes in lib/ sit in a helper that takes the client as its first
// argument (`createDeadlineChain(supabase, …)`), so purely local resolution
// would leave them all "unresolved" and the allowlist would swallow the whole
// class the gate exists to catch. So the check resolves one more step: every
// call to a named function contributes the kind of the client it passes at
// each position, and a parameter resolves to that kind when every caller in
// the tree agrees. Disagreement — or a caller that is itself unresolved —
// collapses to unknown, so this only ever narrows, never guesses.
//
// Run to a fixpoint, because these helpers chain (route → helper → helper).

const PARAM_KINDS = new Map<string, Set<ClientKind>>();

/**
 * Keyed on the DEFINING file, not just the function name: two unrelated
 * helpers that happen to share a name must not vouch for — or incriminate —
 * each other. A call site's defining file is where it imported the name from,
 * or its own file for a local function.
 */
const paramKey = (definingFile: string, fn: string, index: number) =>
  `${definingFile}#${fn}#${index}`;

/** `@/lib/foo` / `./foo` → the absolute file, when it is one we parsed. */
function resolveModule(importer: string, spec: string, known: Set<string>): string | null {
  const base = spec.startsWith('@/')
    ? path.join(ROOT, spec.slice(2))
    : spec.startsWith('.')
      ? path.resolve(path.dirname(importer), spec)
      : null;
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** local imported name → absolute defining file */
function collectImports(source: ts.SourceFile, file: string, known: Set<string>): Map<string, string> {
  const imports = new Map<string, string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteralLike(stmt.moduleSpecifier)) continue;
    const target = resolveModule(file, stmt.moduleSpecifier.text, known);
    if (!target) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) imports.set(el.name.text, target);
    }
    if (stmt.importClause?.name) imports.set(stmt.importClause.name.text, target);
  }

  // `const { spawnComplianceDeliverables } = await import('@/lib/…')`.
  // Not a curiosity: app/api/corporation/route.ts reaches its helper this way,
  // and treating the name as file-local hid the wrong client it passes.
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const init = unwrap(node.initializer);
      if (
        ts.isCallExpression(init) &&
        init.expression.kind === ts.SyntaxKind.ImportKeyword &&
        init.arguments.length > 0 &&
        ts.isStringLiteralLike(init.arguments[0])
      ) {
        const target = resolveModule(file, init.arguments[0].text, known);
        if (target) {
          for (const el of node.name.elements) {
            if (ts.isIdentifier(el.name)) {
              const exported = el.propertyName && ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : el.name.text;
              // Key by the LOCAL name (that is what the call site writes) but
              // remember it resolves into the imported module.
              imports.set(el.name.text, target);
              if (exported !== el.name.text) imports.set(exported, target);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

/**
 * Helpers that hand their callback a client rather than taking one. The
 * cron fan-outs in lib/tenancy/fan-out.ts call
 * `fn({ firm, db: getServiceDbForFirm(firm.id, client) })`, so `db` inside the
 * callback is firm-scoped by construction — every cron write resolves through
 * this. Declared rather than inferred because it is a contract of that module,
 * asserted separately by scripts/cron-probe.ts.
 */
const CALLBACK_CLIENT_CONTRACTS: Record<string, { property: string; kind: ClientKind }> = {
  forEachActiveFirm: { property: 'db', kind: 'scoped' },
  forEachFirmWithFeature: { property: 'db', kind: 'scoped' },
};

/**
 * `forEachActiveFirm(async ({ db }) => … db.from(t).insert(…) …)` → what is
 * `db`? Resolves the *reference* by finding the enclosing callback that
 * destructures that name out of its parameter.
 */
function callbackContractKind(id: ts.Identifier): ClientKind | null {
  let cur: ts.Node | undefined = id.parent;
  while (cur) {
    if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) {
      for (const parameter of cur.parameters) {
        if (!ts.isObjectBindingPattern(parameter.name)) continue;
        const element = parameter.name.elements.find(
          (el) => ts.isIdentifier(el.name) && el.name.text === id.text,
        );
        if (!element) continue;
        const property = element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : (element.name as ts.Identifier).text;
        const call = cur.parent;
        if (
          call &&
          ts.isCallExpression(call) &&
          ts.isIdentifier(call.expression) &&
          call.expression.text in CALLBACK_CLIENT_CONTRACTS
        ) {
          const contract = CALLBACK_CLIENT_CONTRACTS[call.expression.text];
          return contract.property === property ? contract.kind : null;
        }
        return null;
      }
    }
    cur = cur.parent;
  }
  return null;
}

/** A file's local view: what names mean, and where imported names come from. */
type Scope = { file: string; bindings: Bindings; imports: Map<string, string> };

/** Name of the function a parameter belongs to, for `paramKey`. */
function enclosingFunctionName(fn: ts.Node): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) {
    return ts.isIdentifier(fn.name) ? fn.name.text : null;
  }
  // `const createDeadlineChain = async (supabase, …) => …`
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return null;
}

/**
 * Collapse what a helper's callers pass into one verdict.
 *
 * Disagreement is NOT "we don't know" — it is the shape all four remaining
 * bugs took: a shared lib/ helper that inserts an unstamped row, correct on
 * its cron callers (which hand it a firm-scoped client) and broken on the one
 * authed handler that also calls it. So a single non-stamping caller decides
 * it: if any caller can reach this insert with a client that won't stamp
 * firm_id, the insert needs firm_id of its own.
 */
function collapse(kinds: Set<ClientKind> | undefined): ClientKind {
  if (!kinds || kinds.size === 0) return 'unknown';
  if (kinds.has('authed')) return 'authed';
  if (kinds.has('raw')) return 'raw';
  if (kinds.has('unknown')) return 'unknown';
  return 'scoped';
}

/** If `id` names a parameter of an enclosing function, what do callers pass? */
function parameterKind(id: ts.Identifier, scope: Scope): ClientKind {
  let cur: ts.Node | undefined = id.parent;
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      const index = cur.parameters.findIndex(
        (p) => ts.isIdentifier(p.name) && p.name.text === id.text,
      );
      if (index !== -1) {
        const name = enclosingFunctionName(cur);
        if (!name) return 'unknown';
        return collapse(PARAM_KINDS.get(paramKey(scope.file, name, index)));
      }
    }
    cur = cur.parent;
  }
  return 'unknown';
}

/** One round: fold every call site's argument kinds into PARAM_KINDS. */
function refineParamKinds(parsed: Parsed[]): boolean {
  const observed = new Map<string, Set<ClientKind>>();
  for (const { scope, source } of parsed) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        const name = ts.isIdentifier(callee) ? callee.text : null;
        if (name && !(name in CLIENT_FACTORIES)) {
          // Local function, or the module this name was imported from.
          const definingFile = scope.imports.get(name) ?? scope.file;
          node.arguments.forEach((arg, i) => {
            if (ts.isSpreadElement(arg)) return;
            const key = paramKey(definingFile, name, i);
            let set = observed.get(key);
            if (!set) observed.set(key, (set = new Set()));
            set.add(clientKindOf(arg, scope));
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  // Replace, don't union: a later round sees callers the first one could not
  // resolve yet (helpers chain three deep here), and carrying the earlier
  // "unknown" forward would pin every chained helper as unresolvable.
  let changed = false;
  for (const [key, kinds] of observed) {
    const previous = PARAM_KINDS.get(key);
    const same =
      previous && previous.size === kinds.size && [...kinds].every((k) => previous.has(k));
    if (!same) {
      PARAM_KINDS.set(key, kinds);
      changed = true;
    }
  }
  return changed;
}

// ── firm_id detection ──────────────────────────────────────────────

type Stamp = 'stamped' | 'absent' | 'unresolved';

function worst(a: Stamp, b: Stamp): Stamp {
  if (a === 'unresolved' || b === 'unresolved') return 'unresolved';
  if (a === 'absent' || b === 'absent') return 'absent';
  return 'stamped';
}

function objectHasFirmId(
  obj: ts.ObjectLiteralExpression,
  ctx: FileContext,
  seen: Set<string>,
): Stamp {
  let spreadVerdict: Stamp = 'absent';
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const key = ts.isComputedPropertyName(prop.name)
        ? ts.isStringLiteralLike(prop.name.expression)
          ? prop.name.expression.text
          : null
        : ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)
          ? prop.name.text
          : null;
      if (key === 'firm_id') return 'stamped';
    } else if (ts.isSpreadAssignment(prop)) {
      // `{ ...base }` — the firm_id may live in `base`.
      const inner = rowsHaveFirmId(prop.expression, ctx, seen);
      if (inner === 'stamped') return 'stamped';
      spreadVerdict = worst(spreadVerdict, inner);
    }
  }
  return spreadVerdict;
}

/**
 * `row.firm_id = …` / `row['firm_id'] = …`, resolved to the exact binding it
 * mutates rather than to a bare name — otherwise one handler stamping its
 * `row` would vouch for a different handler's `row` in the same file.
 */
function firmIdMutatedBindings(source: ts.SourceFile, bindings: Bindings): Set<ts.Expression> {
  const mutated = new Set<ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = node.left;
      const base =
        ts.isPropertyAccessExpression(target) && target.name.text === 'firm_id'
          ? target.expression
          : ts.isElementAccessExpression(target) &&
              ts.isStringLiteralLike(target.argumentExpression) &&
              target.argumentExpression.text === 'firm_id'
            ? target.expression
            : null;
      if (base && ts.isIdentifier(base)) {
        for (const init of lookup(base.text, base, bindings) ?? []) mutated.add(init);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return mutated;
}

/**
 * `const rows = []; … rows.push({ … }); … .insert(rows)`. Without this the
 * declaration is an empty array literal, which writes nothing and would pass —
 * and that is not a hypothetical: `deadline_chain_items` in
 * lib/legal/deadline-chains.ts is built exactly this way and was unstamped.
 * Keyed on the binding, for the same reason as firmIdMutatedBindings.
 */
function pushedValues(source: ts.SourceFile, bindings: Bindings): Map<ts.Expression, ts.Expression[]> {
  const pushes = new Map<ts.Expression, ts.Expression[]>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'push' || node.expression.name.text === 'unshift') &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const base = node.expression.expression;
      for (const init of lookup(base.text, base, bindings) ?? []) {
        const list = pushes.get(init);
        if (list) list.push(...node.arguments);
        else pushes.set(init, [...node.arguments]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return pushes;
}

type FileContext = {
  source: ts.SourceFile;
  bindings: Bindings;
  firmIdMutated: Set<ts.Expression>;
  pushes: Map<ts.Expression, ts.Expression[]>;
};

function rowsHaveFirmId(expr: ts.Expression, ctx: FileContext, seen: Set<string>): Stamp {
  const node = unwrap(expr);

  if (ts.isObjectLiteralExpression(node)) return objectHasFirmId(node, ctx, seen);

  if (ts.isArrayLiteralExpression(node)) {
    const pushed = ctx.pushes.get(node) ?? [];
    const elements = [...node.elements, ...pushed];
    if (elements.length === 0) return 'stamped'; // nothing is written
    let verdict: Stamp = 'stamped';
    for (const el of elements) {
      const element = ts.isSpreadElement(el) ? el.expression : el;
      verdict = worst(verdict, rowsHaveFirmId(element, ctx, seen));
    }
    return verdict;
  }

  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return 'unresolved';
    seen.add(node.text);
    const inits = lookup(node.text, node, ctx.bindings);
    if (!inits || inits.length === 0) return 'unresolved';
    if (inits.some((init) => ctx.firmIdMutated.has(init))) return 'stamped';
    let verdict: Stamp = 'stamped';
    for (const init of inits) verdict = worst(verdict, rowsHaveFirmId(init, ctx, seen));
    return verdict;
  }

  if (ts.isConditionalExpression(node)) {
    return worst(
      rowsHaveFirmId(node.whenTrue, ctx, seen),
      rowsHaveFirmId(node.whenFalse, ctx, seen),
    );
  }

  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    // `xs.map(x => ({ … }))` / `xs.map(function (x) { return { … }; })` —
    // the row shape is the callback's return value.
    if (
      ts.isPropertyAccessExpression(callee) &&
      (callee.name.text === 'map' || callee.name.text === 'flatMap') &&
      node.arguments.length > 0
    ) {
      const fn = unwrap(node.arguments[0]);
      if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
        return returnedRowsHaveFirmId(fn, ctx, seen);
      }
    }
    return 'unresolved';
  }

  return 'unresolved';
}

function returnedRowsHaveFirmId(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  ctx: FileContext,
  seen: Set<string>,
): Stamp {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
    return rowsHaveFirmId(fn.body, ctx, seen);
  }
  const body = fn.body as ts.Block;
  let verdict: Stamp | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) {
      verdict = verdict === null
        ? rowsHaveFirmId(node.expression, ctx, seen)
        : worst(verdict, rowsHaveFirmId(node.expression, ctx, seen));
    }
    // Don't descend into nested functions — their returns aren't this one's.
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) {
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return verdict ?? 'unresolved';
}

// ── Site collection ────────────────────────────────────────────────

type Site = {
  file: string;
  line: number;
  table: string;
  op: 'insert' | 'upsert';
  client: ClientKind;
  stamp: Stamp;
};

type Parsed = { file: string; source: ts.SourceFile; scope: Scope; ctx: FileContext };

function parseFile(file: string, content: string, known: Set<string>): Parsed {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = collectBindings(source);
  return {
    file,
    source,
    scope: { file, bindings, imports: collectImports(source, file, known) },
    ctx: {
      source,
      bindings,
      firmIdMutated: firmIdMutatedBindings(source, bindings),
      pushes: pushedValues(source, bindings),
    },
  };
}

function collectSites({ file, source, scope, ctx }: Parsed): Site[] {
  const sites: Site[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (
        ts.isPropertyAccessExpression(callee) &&
        (callee.name.text === 'insert' || callee.name.text === 'upsert')
      ) {
        const fromCall = unwrap(callee.expression);
        if (
          ts.isCallExpression(fromCall) &&
          ts.isPropertyAccessExpression(fromCall.expression) &&
          fromCall.expression.name.text === 'from' &&
          fromCall.arguments.length > 0
        ) {
          const tableArg = unwrap(fromCall.arguments[0]);
          // A computed table name (`supabase.from(config.dbTable)`) can't be
          // checked against the registry, so it is treated as possibly-tenant
          // rather than skipped. This is not hypothetical: /api/admin/[entity]
          // routes every admin create through one dynamic table name, and that
          // is where the third instance of this bug hid.
          const dynamic = !ts.isStringLiteralLike(tableArg);
          const table = dynamic
            ? `${tableArg.getText(source)} (computed)`
            : (tableArg as ts.StringLiteralLike).text;
          if (dynamic || TENANT_TABLES.has(table)) {
            const client = clientKindOf(fromCall.expression.expression, scope);
            const stamp =
              node.arguments.length > 0
                ? rowsHaveFirmId(node.arguments[0], ctx, new Set())
                : 'unresolved';
            sites.push({
              file: path.relative(ROOT, file),
              line: source.getLineAndCharacterOfPosition(callee.name.getStart(source)).line + 1,
              table,
              op: callee.name.text as 'insert' | 'upsert',
              client,
              stamp,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) yield full;
  }
}

const CLIENT_LABEL: Record<ClientKind, string> = {
  authed: 'authed client (getSupabaseServerAuthClient)',
  scoped: 'firm-scoped client (getServiceDbForFirm)',
  raw: 'raw service-role client (getSupabase)',
  unknown: 'unresolved client',
};

function main() {
  const listAll = process.argv.includes('--list');

  const files: string[] = [];
  for (const dir of SCAN_DIRS) files.push(...walk(path.join(ROOT, dir)));
  const known = new Set(files);
  const parsed: Parsed[] = files.map((abs) =>
    parseFile(abs, fs.readFileSync(abs, 'utf-8'), known),
  );

  // Helpers chain, so iterate until the parameter kinds stop moving. The
  // cap is a safety net, not a limit anything real reaches.
  for (let round = 0; round < 8; round += 1) {
    if (!refineParamKinds(parsed)) break;
  }

  const sites: Site[] = parsed.flatMap(collectSites);
  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const key = (s: Site) => `${s.file}:${s.line}:${s.table}:${s.op}`;
  const violations: Site[] = [];
  const unresolved: Site[] = [];
  const allowed: Site[] = [];

  for (const site of sites) {
    if (listAll) {
      console.log(`  ${site.stamp.padEnd(10)} ${site.client.padEnd(8)} ${key(site)}`);
    }
    if (site.stamp === 'stamped') continue;
    if (site.client === 'scoped') continue; // the facade stamps it
    if (ALLOWLIST[key(site)]) {
      allowed.push(site);
      continue;
    }
    if (site.stamp === 'absent' && (site.client === 'authed' || site.client === 'raw')) {
      violations.push(site);
    } else {
      unresolved.push(site);
    }
  }

  const staleAllowlist = Object.keys(ALLOWLIST).filter(
    (k) => !sites.some((s) => key(s) === k && s.stamp !== 'stamped' && s.client !== 'scoped'),
  );

  if (violations.length > 0) {
    console.error(
      'Tenant-table writes with no explicit firm_id, on a client that does not stamp it.',
    );
    console.error(
      'firm_id is NOT NULL with no default: these fail at runtime with 23502 (or 42501',
    );
    console.error('when the RLS with_check evaluates first). Stamp it, or write through');
    console.error('getServiceDbForFirm(firmId).\n');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.op} into '${v.table}' — ${CLIENT_LABEL[v.client]}`);
    }
    console.error('');
  }

  if (unresolved.length > 0) {
    console.error('Tenant-table writes this check could not resolve statically.');
    console.error('Read each one: fix it if the firm_id is genuinely missing, or add an');
    console.error('ALLOWLIST entry in this script with a one-line reason.\n');
    for (const u of unresolved) {
      console.error(
        `  ${u.file}:${u.line}  ${u.op} into '${u.table}' — ${CLIENT_LABEL[u.client]}, firm_id ${u.stamp}`,
      );
    }
    console.error('');
  }

  if (staleAllowlist.length > 0) {
    console.warn('Note: ALLOWLIST entries that no longer match a site — prune them:');
    for (const k of staleAllowlist) console.warn(`  ${k}`);
  }

  if (violations.length > 0 || unresolved.length > 0) process.exit(1);

  console.log(
    `audit-firm-id-stamping: clean (${sites.length} tenant-table writes checked, ` +
      `${allowed.length} allowlisted, 0 violations)`,
  );
}

main();
