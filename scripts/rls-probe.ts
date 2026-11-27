import './load-env';
import './probe-websocket';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mintId } from '../lib/ids';
import { TENANT_TABLES, TENANT_VIEWS, GLOBAL_TABLES } from '../lib/tenancy/tables.generated';
import { getServiceDbForFirm } from '../lib/tenancy/service-db';
import { STATUS_ORDER } from '../lib/deliverable-status';
import { generateBundleInvoice } from '../lib/billing/generate-bundle-invoice';
import { dtrIdsFromLineItems } from '../lib/billing/persist-invoice';
import { checkBundleCleared } from '../lib/finance/bundle-gate';

/**
 * Cross-tenant RLS probe. Provisions two disposable firms (probe-a, probe-b)
 * with real auth users, exercises each persona through PostgREST (the same
 * path the app uses), and asserts the target isolation matrix:
 *
 *   - firm-wide reads return only own-firm rows
 *   - matter membership and role fall-throughs are firm-bound
 *   - personal-data tables stay personal AND firm-bound
 *   - a portal user's JWT reads no firm table — only its own client_users
 *     row and its own portal chat; the portal reads through the service client
 *   - cross-firm writes fail (RLS violation or 0 rows)
 *   - deny-by-default tables deny every authed persona
 *   - views show no more than their base tables, and take no writes
 *   - anon gets nothing
 *
 * Run BEFORE the RLS rework to see the leak baseline (expected red), and
 * after it as the gate (must be green). Exits 1 on any violation.
 *
 * Usage: npx tsx scripts/rls-probe.ts
 */

const URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const PW = 'Probe-' + Math.random().toString(36).slice(2) + 'A1!';

const service = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Persona = {
  key: string;
  email: string;
  kind: 'team' | 'portal';
  role?: string;
  firm: 'A' | 'B';
  client?: SupabaseClient;
};

// The first five are positional (destructured in main()); the finance pair is
// appended because only the invoice section needs them — every finance read in
// that pipeline (billing_rates, matter_billing_configs, invoices) is gated on
// the finance/admin/super_user role, so a lawyer would silently bill nothing.
const personas: Persona[] = [
  { key: 'A-partner', email: 'probe-a-partner@lumilex.test', kind: 'team', role: 'partner', firm: 'A' },
  { key: 'A-lawyer', email: 'probe-a-lawyer@lumilex.test', kind: 'team', role: 'lawyer', firm: 'A' },
  { key: 'B-lawyer', email: 'probe-b-lawyer@lumilex.test', kind: 'team', role: 'lawyer', firm: 'B' },
  { key: 'A-portal', email: 'probe-a-client@lumilex.test', kind: 'portal', firm: 'A' },
  { key: 'B-portal', email: 'probe-b-client@lumilex.test', kind: 'portal', firm: 'B' },
  { key: 'A-finance', email: 'probe-a-finance@lumilex.test', kind: 'team', role: 'finance', firm: 'A' },
  { key: 'B-finance', email: 'probe-b-finance@lumilex.test', kind: 'team', role: 'finance', firm: 'B' },
];

/** Billing month the invoice fixtures live in. Fixed, not "now": the letter's
 *  period, the number's `PREFIX-YYYY-MM-###` shape and the balance label are
 *  all asserted verbatim. */
const BILLING_MONTH = '2026-06';
/** hourly_rate × the DTR hours below is the invoice's whole fee total. */
const PROBE_POSITION = 'Probe Associate';
const PROBE_RATE = 1000;

type Fixtures = {
  firmId: string;
  clientId: string;
  clientName: string;
  matterId: string;
  taskId: string;
  announcementId: string;
  fileId: string;
  /** An External deliverable with a due date — what the Filings list shows. */
  filingId: string;
  /** A deliverable_files row on it — a row of `v_deliverable_version_lookup`. */
  deliverableFileId: number;
  /** A pending leave filed by this firm's lawyer. */
  leaveId: string;
  /** This firm's own invoice-number prefix — distinct per firm on purpose. */
  invoicePrefix: string;
  personIds: Record<string, string>;
};

const fx: Record<'A' | 'B', Fixtures> = {} as never;
const authUserIds: string[] = [];
/** Firm ids this run minted. Teardown resolves firms by slug, which is what
 *  cleans up after a crash — but the invoice pipeline puts objects in storage
 *  under the firm *id*, so if the `firms` row is gone by then (a concurrent run
 *  claimed the same slugs) those objects have nothing left pointing at them.
 *  Remembering the ids keeps the storage sweep honest either way. */
const provisionedFirmIds: string[] = [];

// Teardown order matters: children before parents, firms last. Includes
// rows that triggers create as side effects of the fixtures (chat channels,
// matter summaries/health).
const FIXTURE_TABLES = [
  'portal_chat_messages', 'chat_messages', 'chat_channels', 'matter_summaries', 'matter_exec_summaries', 'matter_health',
  'code_provision_reviews', 'code_provision_versions', 'code_provisions', 'legal_codes',
  'court_rule_sections', 'file_analyses', 'files', 'audit_log', 'tasks', 'content_revisions', 'kb_pages',
  // Billing: matter_expenses points at invoices with no ON DELETE, so it goes
  // first; everything here is either a fixture or something the invoice
  // pipeline wrote (invoices, its per-firm number counter, the linked rows).
  'matter_expenses', 'reimbursements', 'invoice_payments', 'invoices',
  'deliverable_files', 'deliverables',
  'invoice_number_counters', 'matter_billing_configs', 'expense_revisions',
  'dtr_revisions', 'dtr_revision_reviews', 'billing_rates',
  'matters', 'client_users', 'clients',
  'announcements', 'dtr', 'user_preferences', 'team', 'firm_invoice_settings',
  'firm_integrations', 'calendar_feed_tokens', 'leaves',
];

async function ensureAuthUser(email: string): Promise<string> {
  const { data: created, error } = await service.auth.admin.createUser({
    email, password: PW, email_confirm: true,
  });
  if (!error) { authUserIds.push(created.user.id); return created.user.id; }
  // Already exists from a crashed prior run: look it up and reset the password.
  const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 });
  const found = list?.users.find((u) => u.email === email);
  if (!found) throw new Error(`auth user create failed for ${email}: ${error.message}`);
  await service.auth.admin.updateUserById(found.id, { password: PW });
  authUserIds.push(found.id);
  return found.id;
}

async function insertOrThrow(table: string, row: Record<string, unknown>) {
  const { error } = await service.from(table).insert(row);
  if (error) throw new Error(`fixture insert into ${table} failed: ${error.message}`);
}

async function provisionFirm(which: 'A' | 'B'): Promise<Fixtures> {
  const slug = `probe-${which.toLowerCase()}`;
  const { data: firm, error: firmErr } = await service
    .from('firms')
    .insert({
      slug, name: `Probe Firm ${which}`, short_name: `P${which}`,
      // The invoice pipeline renders a DOCX letter and a breakdown PDF in the
      // firm's own kit, and brandFromConfig / loadDocxBrand throw on an unset
      // palette, nameLines or documentName rather than substituting.
      branding: {
        nameLines: [`Probe Firm ${which}`],
        documentName: `Probe Firm ${which}`,
        palette: which === 'A'
          ? { primary: '#1F3A5F', accent: '#B08D57' }
          : { primary: '#4A1F3A', accent: '#57B08D' },
        fontSet: 'standard',
      },
    })
    .select('id')
    .single();
  if (firmErr) throw new Error(`firm insert failed: ${firmErr.message}`);
  const firmId = firm.id as string;
  provisionedFirmIds.push(firmId);

  const personIds: Record<string, string> = {};
  for (const p of personas.filter((p) => p.firm === which && p.kind === 'team')) {
    const authId = await ensureAuthUser(p.email);
    const personId = mintId('user');
    personIds[p.key] = personId;
    await insertOrThrow('team', {
      notion_id: personId, person_id: personId, name: p.key, email: p.email,
      role: p.role, active: true, auth_user_id: authId, firm_id: firmId,
      // fetch-billing-data maps team.position → billing_rates.hourly_rate; an
      // unset position silently falls back to 'Junior Associate' at rate 0.
      position: PROBE_POSITION,
    });
  }

  const clientId = mintId('client');
  await insertOrThrow('clients', {
    notion_id: clientId, name: `Probe Client ${which}`, firm_id: firmId,
  });

  for (const p of personas.filter((p) => p.firm === which && p.kind === 'portal')) {
    const authId = await ensureAuthUser(p.email);
    await insertOrThrow('client_users', {
      auth_user_id: authId, client_id: clientId, email: p.email,
      name: p.key, active: true, firm_id: firmId,
    });
  }

  const lawyerKey = `${which}-lawyer`;
  const matterId = mintId('matter');
  await insertOrThrow('matters', {
    notion_id: matterId, name: `Probe Matter ${which}`, client_id: clientId,
    client_name: `Probe Client ${which}`, team_person_ids: [personIds[lawyerKey]],
    firm_id: firmId,
  });

  const taskId = mintId('task');
  await insertOrThrow('tasks', {
    notion_id: taskId, name: `Probe Task ${which}`, matter_id: matterId,
    matter_name: `Probe Matter ${which}`, status: 'Not started', done: false,
    assignee_ids: [personIds[lawyerKey]], firm_id: firmId,
  });

  const announcementId = mintId('announcement');
  await insertOrThrow('announcements', {
    notion_id: announcementId, name: `Probe Announcement ${which}`, firm_id: firmId,
  });

  // Rows that make the deny checks meaningful (a deny check against an
  // empty table proves nothing).
  const fileId = mintId('file');
  await insertOrThrow('files', {
    notion_id: fileId, name: `Probe File ${which}`, firm_id: firmId,
  });
  await insertOrThrow('audit_log', {
    entity_type: 'Probe', entity_id: matterId, action: 'probe', firm_id: firmId,
    performed_by: personIds[lawyerKey],
  });
  // Personal-data row keyed by the lawyer's email (user_preferences is keyed on
  // (firm_id, email); every other column is a defaulted boolean/timestamp).
  await insertOrThrow('user_preferences', {
    email: `probe-${which.toLowerCase()}-lawyer@lumilex.test`, firm_id: firmId,
  });
  // A feature row carrying a (fake) sealed credential. The deny checks below
  // are only meaningful against a row that exists and holds something worth
  // stealing.
  await insertOrThrow('firm_integrations', {
    firm_id: firmId, feature: 'sharepoint', enabled: true,
    config: { tenantId: `tenant-${which}`, clientId: `client-${which}` },
    credentials_enc: `v1.probe-${which.toLowerCase()}-sealed-blob`,
  });

  // A calendar feed token. It is a bearer credential — anyone holding it reads
  // that person's hearings, matters and clients with no session at all — so the
  // deny checks below need a real row to fail to reach.
  await insertOrThrow('calendar_feed_tokens', {
    firm_id: firmId, person_id: personIds[lawyerKey],
    token: `probe-${which.toLowerCase()}-feed-token`,
  });

  // A filing (an External deliverable with a due date), and the row behind
  // the version lookup, which joins deliverable_files to deliverables. Not
  // finalized and no drafters, so neither the analysis webhook nor the
  // assignment notification fires.
  const filingId = mintId('deliverable');
  await insertOrThrow('deliverables', {
    notion_id: filingId, name: `Probe Filing ${which}`, matter_id: matterId,
    matter_name: `Probe Matter ${which}`, type: 'External',
    external_due_date: '2026-12-01', status: STATUS_ORDER[0], firm_id: firmId,
  });
  const { data: dfRow, error: dfErr } = await service
    .from('deliverable_files')
    .insert({
      deliverable_id: filingId, version: 1, file_name: `probe-${which.toLowerCase()}-v1.docx`,
      file_url: `${firmId}/probe/v1.docx`, uploaded_by: personIds[lawyerKey], firm_id: firmId,
    })
    .select('id')
    .single();
  if (dfErr) throw new Error(`fixture insert into deliverable_files failed: ${dfErr.message}`);

  // A pending leave, so the self-approval deny check below has a real row to
  // fail to change and the partner control has one to succeed on.
  const leaveId = mintId('leave');
  await insertOrThrow('leaves', {
    notion_id: leaveId, person_id: personIds[lawyerKey], status: 'Pending',
    approved: false, firm_id: firmId,
  });

  // The two internal AI summaries of the matter. Both are written for the
  // firm's lawyers, and neither may reach the matter's client. Inserting the
  // matter may already have created the brief row through a trigger, so fill
  // that one in rather than inserting a second.
  const briefText = `Probe internal brief ${which}`;
  const { data: existingBrief } = await service
    .from('matter_summaries').select('matter_id').eq('matter_id', matterId).maybeSingle();
  if (existingBrief) {
    const { error } = await service.from('matter_summaries').update({ summary: briefText }).eq('matter_id', matterId);
    if (error) throw new Error(`fixture matter_summaries update failed: ${error.message}`);
  } else {
    await insertOrThrow('matter_summaries', { matter_id: matterId, summary: briefText, firm_id: firmId });
  }
  await insertOrThrow('matter_exec_summaries', {
    matter_id: matterId, overview: `Probe internal overview ${which}`, firm_id: firmId,
  });

  const invoicePrefix = `PRB${which}`;
  const clientName = `Probe Client ${which}`;
  await provisionBillableBundle(which, firmId, clientId, clientName, matterId, personIds);

  return {
    firmId, clientId, clientName, matterId, taskId, announcementId, fileId,
    filingId, deliverableFileId: dfRow.id as number, leaveId, invoicePrefix, personIds,
  };
}

/**
 * Everything a bundle needs to bill: the firm's own invoice settings (complete —
 * getFirmInvoiceSettings refuses a blank OR placeholder field), a rate card, a
 * matter billing config, unbilled DTR and an unbilled matter expense, and a
 * review row that is approved AND cleared so the handlers' two-signature gate
 * lets generation through.
 *
 * Deliberately one lawyer, one rate, one expense: the invoice's totals are then
 * arithmetic the assertions can state exactly (2.5h × 1000 + 500 = 3000).
 */
async function provisionBillableBundle(
  which: 'A' | 'B',
  firmId: string,
  clientId: string,
  clientName: string,
  matterId: string,
  personIds: Record<string, string>,
) {
  const lawyerKey = `${which}-lawyer`;

  await insertOrThrow('firm_invoice_settings', {
    firm_id: firmId,
    firm_address: `Probe Address ${which}`,
    firm_address2: '',
    firm_tin: `000-000-00${which === 'A' ? 1 : 2}`,
    bank_name: `Probe Bank ${which}`,
    bank_account_no: `10000000${which === 'A' ? 1 : 2}`,
    bank_account_name: `Probe Firm ${which}`,
    signer_name: `${which}-partner`,
    // Per firm, and checked against ^[A-Z0-9]{2,8}$ in the database.
    invoice_prefix: `PRB${which}`,
  });

  await insertOrThrow('billing_rates', {
    firm_id: firmId, position: PROBE_POSITION, hourly_rate: PROBE_RATE,
  });

  await insertOrThrow('matter_billing_configs', {
    firm_id: firmId, matter_id: matterId, billing_type: 'litigation',
    engagement_date: '2026-01-05',
  });

  // 2h30 = 2.5 decimal hours. `remarks` must not start with "Status Report",
  // which dtr_set_non_billable() would flip to non_billable.
  await insertOrThrow('dtr', {
    notion_id: mintId('dtr'), firm_id: firmId, date: `${BILLING_MONTH}-10`,
    lawyer_name: lawyerKey, client_name: clientName, matter_id: matterId,
    task: 'Meeting', remarks: `Probe billable work ${which}`,
    hours: 2, minutes: 30, billed: false,
  });

  await insertOrThrow('matter_expenses', {
    firm_id: firmId, matter_id: matterId, description: `Probe filing fee ${which}`,
    amount: 500, category: 'Filing fee', expense_date: `${BILLING_MONTH}-12`,
    billed: false, created_by: personIds[lawyerKey],
  });

  await insertOrThrow('dtr_revision_reviews', {
    firm_id: firmId, billing_month: BILLING_MONTH, client_name: clientName,
    status: 'approved', clearance_status: 'cleared',
    reviewed_by: personIds[`${which}-partner`] ?? personIds[lawyerKey],
  });
}

async function signIn(p: Persona): Promise<SupabaseClient> {
  const client = createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: p.email, password: PW });
  if (error) throw new Error(`sign-in failed for ${p.key}: ${error.message}`);
  return client;
}

// ── Assertions ─────────────────────────────────────────────────────

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '  PASS' : '✗ FAIL'}  ${name}${pass ? '' : `  — ${detail}`}`);
}

async function expectRows(
  name: string, client: SupabaseClient, table: string,
  filter: Record<string, string>, expected: number, columns = '*',
) {
  let q = client.from(table).select(columns);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data, error } = await q;
  if (error) { record(name, false, `query error: ${error.message}`); return; }
  record(name, (data?.length ?? 0) === expected, `expected ${expected} rows, got ${data?.length ?? 0}`);
}

async function expectWriteDenied(
  name: string, client: SupabaseClient, table: string,
  values: Record<string, unknown>, match: Record<string, string>,
) {
  const { data, error } = await client.from(table).update(values).match(match).select('*');
  const denied = !!error || (data?.length ?? 0) === 0;
  record(name, denied, error ? `error (ok): ${error.message}` : `updated ${data?.length ?? 0} rows`);
}

// An RPC the caller holds no EXECUTE on. Only 42501 passes: a PGRST202 would
// mean PostgREST stopped seeing the function, which proves nothing about who
// may run it.
async function expectRpcDenied(
  name: string, client: SupabaseClient, fn: string, args: Record<string, unknown>,
) {
  const { error } = await client.rpc(fn, args);
  record(name, error?.code === '42501',
    error ? `expected 42501, got ${error.code}: ${error.message}` : 'call succeeded');
}

// Insert must be rejected outright, or at minimum must not land with the
// firm_id the caller asked for. If the row lands with the requested foreign
// firm stamped, that is a cross-tenant write — report the stamped firm.
async function expectInsertNotCrossFirm(
  name: string, client: SupabaseClient, table: string,
  row: Record<string, unknown>, idColumn: string, forbiddenFirmId: string,
) {
  const { error } = await client.from(table).insert(row);
  if (error) { record(name, true, `error (ok): ${error.message}`); return; }
  const { data: landed } = await service
    .from(table).select('firm_id').eq(idColumn, row[idColumn] as string).maybeSingle();
  await service.from(table).delete().eq(idColumn, row[idColumn] as string);
  const stamped = landed?.firm_id as string | undefined;
  record(name, stamped !== forbiddenFirmId,
    `insert succeeded; row stamped with firm_id=${stamped ?? '(row not found)'}`);
}

/**
 * The catalog-wide half of "no firm_id column has a DEFAULT".
 *
 * A re-added default is the one firm_id regression `npm run verify:firm-id`
 * structurally cannot see — that gate reads TypeScript, and a column default
 * lives in the database. So every table that carries firm_id gets an insert
 * that omits it, and the refusal has to be the RIGHT refusal.
 *
 * The work is done by `firm_id_insert_refusal_probe()`
 * (20260825_firm_id_insert_refusal_probe.sql) rather than here, for two
 * reasons this check would otherwise fail on:
 *
 *  - **The refusal has to be attributable.** Most of these tables have other
 *    NOT NULL columns, so a bare insert is refused for whichever of them sorts
 *    first — which says nothing about firm_id. The function reads the catalog
 *    and fills every other required column, leaving firm_id as the only thing
 *    missing, so the one expected outcome is 23502 naming firm_id. Anything
 *    else — 23502 on another column, a 42501, a 23503, an accepted insert — is
 *    reported as its own verdict and fails.
 *  - **~130 inserts have to leave nothing behind.** They run server-side in one
 *    round trip, each in its own subtransaction, and an insert that SUCCEEDS is
 *    rolled back immediately (the failure case is as clean as the passing one).
 *    Identity and serial columns are pinned rather than defaulted, because
 *    nextval() would survive the rollback.
 *
 * Enumeration is the catalog's, not a list here, so a table added tomorrow is
 * covered tomorrow.
 */
type RefusalRow = {
  table_name: string;
  verdict: string;
  error_state: string | null;
  error_column: string | null;
  detail: string | null;
};

async function firmIdRefusalSweep() {
  console.log('── firm_id refusal, every table (from the catalog) ──');
  const started = Date.now();
  const [{ data, error }, { data: catalog, error: catalogErr }] = await Promise.all([
    service.rpc('firm_id_insert_refusal_probe'),
    service.rpc('tenant_tables'),
  ]);
  const elapsed = Date.now() - started;

  if (error) {
    record('insert omitting firm_id is rejected on every firm_id table', false,
      `firm_id_insert_refusal_probe() failed: ${error.message}`);
    return;
  }
  const rows = (data ?? []) as RefusalRow[];
  const wrong = rows.filter((r) => r.verdict !== 'refused_firm_id_not_null');
  record(
    `insert omitting firm_id is rejected on every firm_id table (${rows.length} tables, ${elapsed}ms)`,
    rows.length > 0 && wrong.length === 0,
    rows.length === 0
      ? 'the RPC returned no tables — it should enumerate every table carrying firm_id'
      : wrong
          .map((r) =>
            `${r.table_name}: ${r.verdict}` +
            (r.error_state ? ` [${r.error_state}${r.error_column ? ` on ${r.error_column}` : ''}]` : '') +
            (r.detail ? ` — ${r.detail}` : ''),
          )
          .join('; '),
  );

  // The sweep enumerates from the catalog; tenant_tables() is what generates
  // lib/tenancy/tables.generated.ts. If the two disagree, one of them is wrong
  // and the sweep's coverage claim is worth nothing.
  const probed = new Set(rows.map((r) => r.table_name));
  const declared = new Set((catalogErr ? [] : ((catalog ?? []) as string[])));
  const unprobed = [...declared].filter((t) => !probed.has(t));
  const extra = [...probed].filter((t) => !declared.has(t));
  record(
    'the sweep covered every table tenant_tables() reports',
    !catalogErr && declared.size > 0 && unprobed.length === 0 && extra.length === 0,
    catalogErr
      ? `tenant_tables() failed: ${catalogErr.message}`
      : `not probed: ${unprobed.join(', ') || 'none'}; probed but unlisted: ${extra.join(', ') || 'none'}`,
  );

  // And the checked-in registry has to match what is actually there — a table
  // added by a migration without regenerating it would otherwise be scoped by
  // nothing and covered by nothing.
  const registered = new Set<string>([...TENANT_TABLES, ...GLOBAL_TABLES]);
  const unregistered = [...probed].filter((t) => !registered.has(t));
  const vanished = [...TENANT_TABLES].filter((t) => !probed.has(t));
  record(
    'lib/tenancy/tables.generated.ts is in step with the catalog',
    unregistered.length === 0 && vanished.length === 0,
    `missing from the registry: ${unregistered.join(', ') || 'none'}; ` +
      `registered but no longer carrying firm_id: ${vanished.join(', ') || 'none'} ` +
      '— run npx tsx scripts/generate-tenant-registry.ts',
  );
}

/**
 * Views are a second way into their base tables, and neither RLS nor the
 * service-role facade looks at them unless told to.
 *
 * `filings` (since dropped) and `v_deliverable_version_lookup` shipped in the baseline without
 * `security_invoker`, so they ran as `postgres` (BYPASSRLS) and skipped every
 * policy on `deliverables` / `deliverable_files`; they also carried the default
 * ALL grant to anon, and `filings` is a simple view, so Postgres made it
 * auto-updatable — the anon key could list every firm's filings and PATCH or
 * DELETE the deliverables behind them. Separately, the service-role facade
 * passed views through unscoped, so `getFilingById(id, firmId)` answered with
 * another firm's row. None of that was visible to a per-table probe.
 *
 * Four halves:
 *  - the catalog, via `view_exposure()`, so a view added tomorrow is held to
 *    the same shape: security_invoker, nothing for anon, no writes for
 *    authenticated, a firm_id, and a TENANT_VIEWS entry;
 *  - reads per persona — every deny paired with a control that must see a row,
 *    so a broken fixture can't pass as isolation;
 *  - writes through the view, then a service-role read proving nothing moved;
 *  - the service-role facade itself, against real rows.
 */
type ViewExposureRow = {
  view_name: string;
  security_invoker: boolean;
  anon_privileges: string[];
  authenticated_write_privileges: string[];
  has_firm_id: boolean;
};

async function viewProbe(
  Ap: SupabaseClient, Al: SupabaseClient, Bl: SupabaseClient,
  Aportal: SupabaseClient, Bportal: SupabaseClient,
) {
  console.log('── views (security_invoker, grants, firm scope) ──');
  const { data, error } = await service.rpc('view_exposure');
  const rows = (data ?? []) as ViewExposureRow[];
  record('view_exposure() lists the public views', !error && rows.length > 0,
    error ? `view_exposure() failed: ${error.message}` : 'returned no views — the probe below would cover nothing');
  const bad = (pick: (r: ViewExposureRow) => boolean, what: (r: ViewExposureRow) => string) =>
    rows.filter(pick).map(what).join('; ') || 'none';
  record('every public view is security_invoker',
    rows.length > 0 && rows.every((r) => r.security_invoker),
    `runs as its owner (skips RLS): ${bad((r) => !r.security_invoker, (r) => r.view_name)}`);
  record('no public view grants anon anything',
    rows.length > 0 && rows.every((r) => r.anon_privileges.length === 0),
    bad((r) => r.anon_privileges.length > 0, (r) => `${r.view_name}: ${r.anon_privileges.join(',')}`));
  record('no public view grants authenticated a write',
    rows.length > 0 && rows.every((r) => r.authenticated_write_privileges.length === 0),
    bad((r) => r.authenticated_write_privileges.length > 0,
      (r) => `${r.view_name}: ${r.authenticated_write_privileges.join(',')}`));
  const catalogViews = new Set(rows.map((r) => r.view_name));
  record('every public view carries firm_id and is registered in TENANT_VIEWS',
    rows.length > 0 && rows.every((r) => r.has_firm_id && TENANT_VIEWS.has(r.view_name))
      && [...TENANT_VIEWS].every((v) => catalogViews.has(v)),
    `no firm_id: ${bad((r) => !r.has_firm_id, (r) => r.view_name)}; ` +
      `unregistered: ${bad((r) => !TENANT_VIEWS.has(r.view_name), (r) => r.view_name)}; ` +
      `registered but gone: ${[...TENANT_VIEWS].filter((v) => !catalogViews.has(v)).join(', ') || 'none'} ` +
      '— run npx tsx scripts/generate-tenant-registry.ts');

  const version = (which: 'A' | 'B') => ({ deliverable_file_id: String(fx[which].deliverableFileId) });

  await expectRows('A-lawyer reads own deliverable version through the lookup', Al,
    'v_deliverable_version_lookup', version('A'), 1);
  await expectRows('B-lawyer reads own deliverable version through the lookup', Bl,
    'v_deliverable_version_lookup', version('B'), 1);
  await expectRows('A-lawyer cannot read firm-B deliverable version', Al,
    'v_deliverable_version_lookup', version('B'), 0);
  await expectRows('A-partner cannot read firm-B deliverable version', Ap,
    'v_deliverable_version_lookup', version('B'), 0);
  await expectRows('B-portal cannot read firm-A deliverable version', Bportal,
    'v_deliverable_version_lookup', version('A'), 0);

  const anon = createClient(URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  for (const view of ['v_deliverable_version_lookup', 'corporation_persons']) {
    const { data: rowsSeen, error: anonErr } = await anon.from(view).select('*');
    const refused = anonErr?.code === '42501' || (!anonErr && (rowsSeen?.length ?? 0) === 0);
    record(`anon cannot read ${view}`, refused,
      anonErr ? `unexpected error ${anonErr.code}: ${anonErr.message}` : `read ${rowsSeen?.length} rows`);
  }

  // The service-role facade. The view carries no policy for service_role to
  // skip, so firm_id in the facade is the only pin.
  for (const [view, own, foreign, column] of [
    ['v_deliverable_version_lookup', String(fx.A.deliverableFileId), String(fx.B.deliverableFileId), 'deliverable_file_id'],
  ] as const) {
    const scoped = getServiceDbForFirm(fx.A.firmId, service);
    const { data: mine } = await scoped.from(view).select(column).eq(column, own);
    const { data: theirs } = await scoped.from(view).select(column).eq(column, foreign);
    record(`service-role facade for firm A reads its own ${view} row`, (mine?.length ?? 0) === 1,
      `got ${mine?.length ?? 0} rows`);
    record(`service-role facade for firm A cannot read firm B's ${view} row by id`, (theirs?.length ?? 0) === 0,
      `got ${theirs?.length ?? 0} rows`);
  }
}

/**
 * The invoice write path, end to end, on a real authed client.
 *
 * `persistInvoice` takes its Supabase client as a parameter, so whether the
 * `invoices` row needs an explicit `firm_id` is decided by a caller in another
 * file — and two of its five callers (`/api/finance/dtr-review/generate` and
 * `/api/finance/batch-generate`) reach it on `getSupabaseServerAuthClient()`,
 * which does NOT stamp `firm_id` the way `getServiceDbForFirm` does. That fix
 * was typechecked and gate-clean but had never actually run: the path needs a
 * whole billable bundle behind it.
 *
 * This drives the pipeline both handlers drive — their gate
 * (`checkBundleCleared`), then `generateBundleInvoice` with exactly the
 * arguments they pass — on a client signed in as a real finance user, so the
 * insert goes through PostgREST under `invoices_finance_all`'s WITH CHECK. An
 * unstamped insert cannot pass silently here: `firm_id = current_firm_id()`
 * evaluates NULL and refuses with 42501, or the NOT NULL raises 23502.
 *
 * It lives in this probe rather than a vitest test because nothing in it can be
 * mocked without mocking away the fix: the number is allocated by a
 * SECURITY DEFINER RPC that authorises on the caller's own JWT, the letter and
 * breakdown render from the firm's `firms.branding` row, three objects are
 * uploaded under the firm's storage prefix, and the row is written through RLS.
 */
/**
 * The Library (kb_pages after 20260928_library_merge.sql): one table holding
 * the firm handbook, which lawyers write, and the pages distilled from
 * matters, which only partners and admins edit.
 *
 * Both firms hold a page under the same slug — the key is (firm_id, slug) now,
 * and before the merge a second firm's insert collided with the first's. The
 * write checks read back through the service client, because RLS answers a
 * refused UPDATE or DELETE with zero rows rather than an error.
 */
async function libraryProbe(Ap: SupabaseClient, Al: SupabaseClient, Bl: SupabaseClient) {
  console.log('── library (kb_pages) ──');
  const page = (which: 'A' | 'B', slug: string, extra: Record<string, unknown> = {}) => ({
    slug, kind: 'guide', title: `Probe handbook ${which}`, content_md: '<p>probe</p>', content_format: 'html',
    status: 'published', generated_by: 'manual', author_id: 'system', firm_id: fx[which].firmId, ...extra,
  });

  const shared = 'probe-handbook';
  const { data: rows, error } = await service.from('kb_pages').insert([
    page('A', shared),
    page('B', shared),
    page('A', 'probe-partners-only', { visible_to_roles: ['partner'] }),
    page('A', 'probe-doctrine', { kind: 'doctrine', content_format: 'md', generated_by: 'llm', status: 'draft' }),
  ]).select('id, slug, firm_id');
  record('two firms can each hold a Library page under the same slug', !error && rows?.length === 4,
    error ? `insert failed: ${error.message}` : `inserted ${rows?.length ?? 0} of 4`);
  if (error || !rows) return;
  const idOf = (which: 'A' | 'B', slug: string) =>
    String(rows.find((r) => r.slug === slug && r.firm_id === fx[which].firmId)!.id);
  const aHandbook = idOf('A', shared);
  const bHandbook = idOf('B', shared);
  const partnersOnly = idOf('A', 'probe-partners-only');
  const doctrine = idOf('A', 'probe-doctrine');

  await expectRows('A-lawyer reads own-firm handbook page', Al, 'kb_pages', { id: aHandbook }, 1);
  await expectRows('A-lawyer cannot read firm-B handbook page', Al, 'kb_pages', { id: bHandbook }, 0);
  await expectRows('A-lawyer cannot read a page limited to partners', Al, 'kb_pages', { id: partnersOnly }, 0);
  await expectRows('A-partner reads the page limited to partners', Ap, 'kb_pages', { id: partnersOnly }, 1);

  // Authoring: a lawyer writes handbook kinds only, in their own firm.
  const written = { slug: 'probe-lawyer-guide', kind: 'guide', title: 'Lawyer guide', content_md: '', content_format: 'html',
    status: 'draft', generated_by: 'manual', firm_id: fx.A.firmId };
  const { error: guideErr } = await Al.from('kb_pages').insert(written);
  record('A-lawyer writes a handbook page', !guideErr, guideErr ? `error: ${guideErr.message}` : 'inserted');
  const { error: doctrineErr } = await Al.from('kb_pages').insert({ ...written, slug: 'probe-lawyer-doctrine', kind: 'doctrine' });
  record('A-lawyer cannot write a distilled page', doctrineErr?.code === '42501',
    doctrineErr ? `${doctrineErr.code}: ${doctrineErr.message}` : 'insert succeeded');
  await expectInsertNotCrossFirm('A-lawyer cannot write a page stamped with firm B', Al, 'kb_pages',
    { ...written, slug: 'probe-lawyer-cross-firm', firm_id: fx.B.firmId }, 'slug', fx.B.firmId);

  await expectWriteDenied('A-lawyer cannot edit a distilled page', Al, 'kb_pages', { title: 'rewritten' }, { id: doctrine });
  await expectWriteDenied('B-lawyer cannot edit a firm-A handbook page', Bl, 'kb_pages', { title: 'rewritten' }, { id: aHandbook });
  await Al.from('kb_pages').delete().eq('id', aHandbook);
  const { count: survived } = await service.from('kb_pages').select('id', { count: 'exact', head: true }).eq('id', aHandbook);
  record('A-lawyer cannot delete a handbook page', survived === 1, `page rows left: ${survived ?? 0}`);

  // History is service-role only: the handler decides who sees it.
  await insertOrThrow('content_revisions', {
    entity_type: 'kb_page', entity_id: aHandbook, snapshot: { title: 'before' }, changed_fields: ['title'], firm_id: fx.A.firmId,
  });
  await expectRows('A-partner cannot read content_revisions directly', Ap, 'content_revisions', { entity_id: aHandbook }, 0);
}

/**
 * Keyword search (20260928_document_keyword_search.sql). search_document_text
 * runs on the service client, which bypasses RLS, and `.rpc()` passes through
 * getServiceDbForFirm untouched — the p_firm_id filter inside the function is
 * the only thing keeping one firm's document text out of another's results.
 * Both firms hold a document with the same words; each search must find its
 * own and only its own. The API roles hold no EXECUTE on it.
 */
async function keywordSearchProbe(Al: SupabaseClient) {
  console.log('── keyword search (search_document_text) ──');
  const phrase = 'probe quitclaim zephyrine';
  for (const which of ['A', 'B'] as const) {
    await insertOrThrow('file_analyses', {
      file_id: fx[which].fileId, attachment_name: `probe-${which}.pdf`, status: 'completed', analyzed_by: 'probe',
      extracted_text: `Deed of ${phrase} executed by the parties of firm ${which}.`, firm_id: fx[which].firmId,
    });
  }
  for (const which of ['A', 'B'] as const) {
    const other = which === 'A' ? 'B' : 'A';
    const { data, error } = await service.rpc('search_document_text', { p_firm_id: fx[which].firmId, p_query: phrase, p_limit: 20 });
    const fileIds = ((data ?? []) as { file_id: string }[]).map((r) => r.file_id);
    record(`keyword search for firm ${which} finds its own document`, !error && fileIds.includes(fx[which].fileId),
      error ? `rpc error: ${error.message}` : `returned ${JSON.stringify(fileIds)}`);
    record(`keyword search for firm ${which} does not return firm ${other}'s document`, !error && !fileIds.includes(fx[other].fileId),
      error ? `rpc error: ${error.message}` : `returned ${JSON.stringify(fileIds)}`);
  }
  await expectRpcDenied('A-lawyer cannot call search_document_text', Al, 'search_document_text',
    { p_firm_id: fx.A.firmId, p_query: phrase });
  const anon = createClient(URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await expectRpcDenied('anon cannot call search_document_text', anon, 'search_document_text',
    { p_firm_id: fx.A.firmId, p_query: phrase });

  // The Rules of Court are the same text in every firm, but each firm's rows
  // point at its own Library pages — search_court_rules must stay in its firm.
  const ids: Record<'A' | 'B', string> = { A: '', B: '' };
  for (const which of ['A', 'B'] as const) {
    const { data, error } = await service.from('court_rule_sections').insert({
      source: 'civil', rule: 999, section: 1, rule_title: 'PROBE', title: 'Probe section',
      text: `Within ${phrase} days from notice.`, citation: 'Rule 999, Section 1', firm_id: fx[which].firmId,
    }).select('id').single();
    if (error) throw new Error(`court_rule_sections insert failed: ${error.message}`);
    ids[which] = String(data.id);
  }
  for (const which of ['A', 'B'] as const) {
    const other = which === 'A' ? 'B' : 'A';
    const { data, error } = await service.rpc('search_court_rules', { p_firm_id: fx[which].firmId, p_query: phrase, p_limit: 10 });
    const found = ((data ?? []) as { id: number }[]).map((r) => String(r.id));
    record(`rules search for firm ${which} finds its own section and not firm ${other}'s`,
      !error && found.includes(ids[which]) && !found.includes(ids[other]),
      error ? `rpc error: ${error.message}` : `returned ${JSON.stringify(found)}`);
  }
  await expectRows('A-lawyer reads own-firm Rules of Court section', Al, 'court_rule_sections', { id: ids.A }, 1);
  await expectRows('A-lawyer cannot read firm-B Rules of Court section', Al, 'court_rule_sections', { id: ids.B }, 0);
  await expectWriteDenied('A-lawyer cannot rewrite a Rules of Court section', Al, 'court_rule_sections',
    { text: 'rewritten' }, { id: ids.A });
  await expectRpcDenied('A-lawyer cannot call search_court_rules', Al, 'search_court_rules',
    { p_firm_id: fx.A.firmId, p_query: phrase });
}

/**
 * The codes (20261125_legal_codes.sql). The text is the same in every firm,
 * but the rows are per firm: each code points at its page in one firm's
 * Library, and a review is one firm's sign-off. Staff read their own firm's
 * provisions and history; only the importer writes them; a reviewer records a
 * review as themself, in their own firm, on their own firm's provision.
 * search_code_provisions must stay in its firm, and no API role runs it.
 */
async function legalCodesProbe(Ap: SupabaseClient, Al: SupabaseClient, Bl: SupabaseClient, Aportal: SupabaseClient) {
  console.log('── legal codes (legal_codes, code_provisions, versions, reviews) ──');
  const phrase = 'probe quintessential stevedore';
  const provision: Record<'A' | 'B', number> = { A: 0, B: 0 };
  for (const which of ['A', 'B'] as const) {
    const firmId = fx[which].firmId;
    await insertOrThrow('legal_codes', {
      firm_id: firmId, id: 'probe', title: 'Probe Code', short_title: 'Probe Code', instrument: 'Probe Act', unit: 'article',
    });
    const { data, error } = await service.from('code_provisions').insert({
      firm_id: firmId, code_id: 'probe', number: '1', position: 0, heading: 'Probe article',
      text: `The ${phrase} shall be paid.`, citation: 'Probe Code, art. 1',
    }).select('id').single();
    if (error) throw new Error(`code_provisions insert failed: ${error.message}`);
    provision[which] = data.id as number;
    await insertOrThrow('code_provision_versions', {
      firm_id: firmId, provision_id: provision[which], seq: 0, change: 'original', text: `The ${phrase} shall be paid.`,
    });
  }

  // The composite foreign keys: a firm-A row cannot hang off firm B's code or provision.
  const { error: crossCode } = await service.from('code_provisions').insert({
    firm_id: fx.A.firmId, code_id: 'probe-b-only', number: '1', position: 0, text: 'x', citation: 'x',
  });
  record('a provision cannot name a code its firm does not hold', crossCode?.code === '23503',
    crossCode ? `${crossCode.code}: ${crossCode.message}` : 'insert succeeded');
  const { error: crossVersion } = await service.from('code_provision_versions').insert({
    firm_id: fx.A.firmId, provision_id: provision.B, seq: 9, change: 'amended',
  });
  record("a firm-A version cannot hang off firm B's provision", crossVersion?.code === '23503',
    crossVersion ? `${crossVersion.code}: ${crossVersion.message}` : 'insert succeeded');

  const A = String(provision.A);
  const B = String(provision.B);
  await expectRows('A-lawyer reads own-firm code', Al, 'legal_codes', { id: 'probe', firm_id: fx.A.firmId }, 1);
  await expectRows('A-lawyer cannot read firm-B code', Al, 'legal_codes', { firm_id: fx.B.firmId }, 0);
  await expectRows('A-lawyer reads own-firm provision', Al, 'code_provisions', { id: A }, 1);
  await expectRows('A-lawyer cannot read firm-B provision', Al, 'code_provisions', { id: B }, 0);
  await expectRows("A-lawyer reads own-firm provision's history", Al, 'code_provision_versions', { provision_id: A }, 1);
  await expectRows("A-lawyer cannot read firm-B provision's history", Al, 'code_provision_versions', { provision_id: B }, 0);
  await expectRows('A-portal reads no provision', Aportal, 'code_provisions', { id: A }, 0);
  await expectWriteDenied('A-partner cannot rewrite a provision', Ap, 'code_provisions', { text: 'rewritten' }, { id: A });
  await expectWriteDenied('A-partner cannot rewrite a version', Ap, 'code_provision_versions', { text: 'rewritten' }, { provision_id: A });
  const { error: lawyerAdds } = await Al.from('code_provisions').insert({
    firm_id: fx.A.firmId, code_id: 'probe', number: '2', position: 1, text: 'x', citation: 'x',
  });
  record('A-lawyer cannot add a provision', lawyerAdds?.code === '42501',
    lawyerAdds ? `${lawyerAdds.code}: ${lawyerAdds.message}` : 'insert succeeded');

  // Reviews: a reviewer as themself, in their own firm. The partner's own
  // review is the control — without it, every refusal below proves nothing.
  const review = (which: 'A' | 'B', extra: Record<string, unknown> = {}) => ({
    firm_id: fx.A.firmId, provision_id: provision[which], version_seq: 0, reviewed_by: fx.A.personIds['A-partner'], ...extra,
  });
  const { error: ownReview } = await Ap.from('code_provision_reviews').insert(review('A'));
  record('A-partner records their own review of an own-firm provision', !ownReview,
    ownReview ? `${ownReview.code}: ${ownReview.message}` : 'inserted');
  await expectRows('A-lawyer reads own-firm reviews', Al, 'code_provision_reviews', { provision_id: A }, 1);
  await expectRows('B-lawyer cannot read firm-A reviews', Bl, 'code_provision_reviews', { provision_id: A }, 0);
  const { error: lawyerReview } = await Al.from('code_provision_reviews').insert(review('A', { reviewed_by: fx.A.personIds['A-lawyer'] }));
  record('A-lawyer cannot record a review', lawyerReview?.code === '42501',
    lawyerReview ? `${lawyerReview.code}: ${lawyerReview.message}` : 'insert succeeded');
  const { error: asOther } = await Ap.from('code_provision_reviews').insert(review('A', { reviewed_by: fx.A.personIds['A-lawyer'] }));
  record('A-partner cannot record a review in another person\'s name', asOther?.code === '42501',
    asOther ? `${asOther.code}: ${asOther.message}` : 'insert succeeded');
  const { error: onB } = await Ap.from('code_provision_reviews').insert(review('B'));
  record("A-partner cannot review firm B's provision", !!onB, onB ? `${onB.code}: ${onB.message}` : 'insert succeeded');
  await expectInsertNotCrossFirm('A-partner cannot file a review under firm B', Ap, 'code_provision_reviews',
    review('B', { firm_id: fx.B.firmId, note: 'probe-cross-firm-review' }), 'note', fx.B.firmId);
  await expectWriteDenied('A-partner cannot edit a review', Ap, 'code_provision_reviews', { note: 'rewritten' }, { provision_id: A });
  await Ap.from('code_provision_reviews').delete().eq('provision_id', A);
  const { count: reviewsLeft } = await service.from('code_provision_reviews').select('id', { count: 'exact', head: true }).eq('provision_id', provision.A);
  record('A-partner cannot delete a review', reviewsLeft === 1, `reviews left: ${reviewsLeft ?? 0}`);

  for (const which of ['A', 'B'] as const) {
    const other = which === 'A' ? 'B' : 'A';
    const { data, error } = await service.rpc('search_code_provisions', { p_firm_id: fx[which].firmId, p_query: phrase, p_limit: 10 });
    const found = ((data ?? []) as { id: number }[]).map((r) => r.id);
    record(`codes search for firm ${which} finds its own provision and not firm ${other}'s`,
      !error && found.includes(provision[which]) && !found.includes(provision[other]),
      error ? `rpc error: ${error.message}` : `returned ${JSON.stringify(found)}`);
  }
  await expectRpcDenied('A-lawyer cannot call search_code_provisions', Al, 'search_code_provisions',
    { p_firm_id: fx.A.firmId, p_query: phrase });
  const anon = createClient(URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await expectRpcDenied('anon cannot call search_code_provisions', anon, 'search_code_provisions',
    { p_firm_id: fx.A.firmId, p_query: phrase });
}

async function invoiceProbe(financeA: SupabaseClient, financeB: SupabaseClient) {
  console.log('── invoice generation (finance handlers\' pipeline, authed client) ──');

  const emailOf = (key: string) => personas.find((p) => p.key === key)!.email;
  const generate = (which: 'A' | 'B', client: SupabaseClient) =>
    generateBundleInvoice({
      supabase: client,
      firmId: fx[which].firmId,
      billingMonth: BILLING_MONTH,
      clientName: fx[which].clientName,
      generatedByEmail: emailOf(`${which}-finance`),
      override: null,
    });

  // The gate both handlers run before anything else. A fixture that fails it
  // would make every later check pass for the wrong reason (nothing generated).
  const gate = await checkBundleCleared(financeA, BILLING_MONTH, fx.A.clientName, 'finance');
  record('approved + cleared bundle passes the generation gate', gate === null,
    gate ? `gate refused: ${gate.status} ${gate.error}` : 'gate open');

  const started = Date.now();
  const genA = await generate('A', financeA);
  const elapsed = Date.now() - started;
  record(`A-finance generates firm A's invoice (${elapsed}ms)`,
    genA.ok && !genA.skipped && !!genA.invoiceId,
    genA.ok ? (genA.skipped ? 'skipped: nothing billable — the fixtures did not land' : 'ok')
            : `failed: ${genA.error}`);
  if (!genA.ok || !genA.invoiceId) return;

  const readInvoice = async (id: number) => {
    const { data } = await service.from('invoices').select('*').eq('id', id).maybeSingle();
    return data as Record<string, unknown> | null;
  };

  const invA = await readInvoice(genA.invoiceId);
  record('the invoice row carries the generating firm', invA?.firm_id === fx.A.firmId,
    `firm_id=${String(invA?.firm_id)} expected ${fx.A.firmId}`);

  const numberShape = new RegExp(`^${fx.A.invoicePrefix}-${BILLING_MONTH}-\\d{3}$`);
  record("the invoice number uses that firm's own prefix",
    typeof invA?.invoice_number === 'string' && numberShape.test(invA.invoice_number as string),
    `invoice_number=${String(invA?.invoice_number)} expected ${numberShape.source}`);

  // The line items are a jsonb snapshot on the row, not a child table — so
  // "the line items carry the right firm_id" means every DTR entry they were
  // built from belongs to this firm. A bundle assembled across a firm boundary
  // would show up right here.
  const dtrIds = dtrIdsFromLineItems((invA?.line_items ?? []) as unknown[]);
  const { data: sourceDtr } = await service
    .from('dtr').select('notion_id, firm_id').in('notion_id', dtrIds.length ? dtrIds : ['none']);
  const foreign = (sourceDtr ?? []).filter((d) => d.firm_id !== fx.A.firmId);
  record('every DTR entry behind the line items belongs to that firm',
    dtrIds.length > 0 && (sourceDtr ?? []).length === dtrIds.length && foreign.length === 0,
    `${dtrIds.length} line-item DTR ids, ${(sourceDtr ?? []).length} resolved, ${foreign.length} from another firm`);

  // 2.5h × 1000 + a 500 expense. Exact, so a bundle that quietly picked up
  // another firm's rows (or none) is a failure rather than a shrug.
  record('the totals are this firm’s rows and only this firm’s',
    Number(invA?.total_amount) === 2.5 * PROBE_RATE && Number(invA?.total_expenses) === 500,
    `total_amount=${String(invA?.total_amount)} (expected 2500), total_expenses=${String(invA?.total_expenses)} (expected 500)`);

  const { data: expenses } = await service
    .from('matter_expenses').select('id, firm_id, invoice_id').in('firm_id', [fx.A.firmId, fx.B.firmId]);
  const linkedA = (expenses ?? []).filter((e) => e.invoice_id === genA.invoiceId);
  record('the expense linked to the invoice is that firm’s, and only that firm’s',
    linkedA.length === 1 && linkedA[0].firm_id === fx.A.firmId &&
      (expenses ?? []).filter((e) => e.firm_id === fx.B.firmId && e.invoice_id !== null).length === 0,
    `linked=${linkedA.length}; firm-B expenses linked: ${(expenses ?? []).filter((e) => e.firm_id === fx.B.firmId && e.invoice_id !== null).length}`);

  // client_id is resolved from the name inside persistInvoice and is what the
  // portal's billing loader scopes on — an unresolved one means the client can
  // never see their own bill.
  record('the invoice resolved to that firm’s client row', invA?.client_id === fx.A.clientId,
    `client_id=${String(invA?.client_id)} expected ${fx.A.clientId}`);

  // The frozen settings snapshot is what the letter and the send flow print.
  // It has to be this firm's letterhead and this firm's bank account.
  const snap = (invA?.billing_settings ?? {}) as Record<string, unknown>;
  record('the frozen settings snapshot carries that firm’s own letterhead and bank',
    snap.firmAddress === 'Probe Address A' && snap.bankName === 'Probe Bank A' &&
      snap.bankAccountName === 'Probe Firm A',
    `firmAddress=${String(snap.firmAddress)} bankName=${String(snap.bankName)} bankAccountName=${String(snap.bankAccountName)}`);

  const docxPath = String(invA?.docx_storage_path ?? '');
  const { data: docx } = await service.storage.from('files').download(docxPath);
  record('the letter landed in storage under that firm’s prefix',
    docxPath.startsWith(`${fx.A.firmId}/`) && !!docx && docx.size > 0,
    `path=${docxPath || '(none)'} size=${docx?.size ?? 0}`);

  // The same month, in the other firm. Both must mint …-001: the prefix and the
  // counter are per firm, so B's first invoice is not A's second.
  const genB = await generate('B', financeB);
  const invB = genB.invoiceId ? await readInvoice(genB.invoiceId) : null;
  record("a second firm's first invoice that month is its own …-001, under its own prefix",
    genB.ok && invB?.firm_id === fx.B.firmId &&
      invB?.invoice_number === `${fx.B.invoicePrefix}-${BILLING_MONTH}-001` &&
      invA?.invoice_number === `${fx.A.invoicePrefix}-${BILLING_MONTH}-001`,
    genB.ok
      ? `A=${String(invA?.invoice_number)} B=${String(invB?.invoice_number)} B.firm_id=${String(invB?.firm_id)}`
      : `firm B generation failed: ${genB.error}`);

  // Regenerate: the update branch must not rewrite an existing invoice's
  // tenancy column, and must reuse the number rather than mint a second one.
  const regenA = await generate('A', financeA);
  const reread = regenA.invoiceId ? await readInvoice(regenA.invoiceId) : null;
  record('regenerating in place keeps the same row, number and firm',
    regenA.ok && regenA.invoiceId === genA.invoiceId &&
      reread?.invoice_number === invA?.invoice_number && reread?.firm_id === fx.A.firmId,
    regenA.ok
      ? `id ${genA.invoiceId}→${regenA.invoiceId}, number ${String(invA?.invoice_number)}→${String(reread?.invoice_number)}, firm_id=${String(reread?.firm_id)}`
      : `regenerate failed: ${regenA.error}`);

  await expectRows("the other firm's finance user cannot read this invoice",
    financeB, 'invoices', { invoice_number: String(invA?.invoice_number) }, 0);
  await expectRows('its own finance user can', financeA, 'invoices',
    { invoice_number: String(invA?.invoice_number) }, 1);
}

/** Everything under one storage prefix, folders included — the invoice pipeline
 *  mints its own keys, and cleanup has to work on a crashed run too. */
async function removeUnder(bucket: string, prefix: string): Promise<void> {
  const { data, error } = await service.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) return;
  const objects: string[] = [];
  for (const entry of data ?? []) {
    const child = `${prefix}/${entry.name}`;
    if (entry.id === null) await removeUnder(bucket, child);
    else objects.push(child);
  }
  if (objects.length > 0) await service.storage.from(bucket).remove(objects);
}

async function main() {
  console.log('── teardown of any prior probe run ──');
  await teardown();

  console.log('── provisioning probe firms ──');
  fx.A = await provisionFirm('A');
  fx.B = await provisionFirm('B');
  for (const p of personas) p.client = await signIn(p);

  const [Ap, Al, Bl, Aportal, Bportal] = personas.map((p) => p.client!);
  const clientFor = (key: string) => personas.find((p) => p.key === key)!.client!;

  console.log('── firm-wide reads ──');
  await expectRows('A-lawyer sees own-firm announcement', Al, 'announcements', { notion_id: fx.A.announcementId }, 1);
  await expectRows('A-lawyer cannot see firm-B announcement', Al, 'announcements', { notion_id: fx.B.announcementId }, 0);
  await expectRows('B-lawyer cannot read firm-A team roster', Bl, 'team', { firm_id: fx.A.firmId }, 0, 'person_id');
  await expectRows('A-lawyer reads own-firm team roster', Al, 'team', { firm_id: fx.A.firmId }, personas.filter((p) => p.firm === 'A' && p.kind === 'team').length, 'person_id');

  console.log('── matter scoping ──');
  await expectRows('A-lawyer (member) reads own matter', Al, 'matters', { notion_id: fx.A.matterId }, 1);
  await expectRows('A-partner (role fall-through) reads own-firm matter', Ap, 'matters', { notion_id: fx.A.matterId }, 1);
  await expectRows('A-partner cannot read firm-B matter', Ap, 'matters', { notion_id: fx.B.matterId }, 0);
  await expectRows('B-lawyer cannot read firm-A task', Bl, 'tasks', { notion_id: fx.A.taskId }, 0);

  console.log('── cross-firm writes ──');
  await expectWriteDenied('B-lawyer cannot update firm-A task', Bl, 'tasks',
    { status: 'Done' }, { notion_id: fx.A.taskId });
  await expectWriteDenied('A-lawyer cannot update firm-B matter', Al, 'matters',
    { name: 'hijacked' }, { notion_id: fx.B.matterId });

  console.log('── portal: a client\'s JWT reads no firm table ──');
  // The portal reads through getServiceDbForFirm, scoped to the session's
  // client. Anything an RLS policy admitted, a client could read whole through
  // PostgREST — drafts, internal meetings, invoice line items — so nothing does.
  const { data: aClientUser } = await service
    .from('client_users').select('id').eq('firm_id', fx.A.firmId).eq('client_id', fx.A.clientId).single();
  const portalFileId = mintId('file');
  await insertOrThrow('files', {
    notion_id: portalFileId, name: 'Probe matter file A', matter_id: fx.A.matterId, firm_id: fx.A.firmId,
  });
  await insertOrThrow('portal_chat_messages', {
    client_user_id: aClientUser!.id, matter_id: fx.A.matterId, role: 'user',
    content: 'probe question', firm_id: fx.A.firmId,
  });
  // Controls: the persona is signed in and its own rows still read. Without
  // these, a broken sign-in would pass every deny below.
  await expectRows('A-portal reads its own client_users row (signed in)', Aportal, 'client_users',
    { id: aClientUser!.id as string }, 1, 'id');
  await expectRows('A-portal reads its own portal chat', Aportal, 'portal_chat_messages',
    { matter_id: fx.A.matterId }, 1, 'id');
  await expectRows('A-lawyer reads the matter file the portal must not', Al, 'files', { notion_id: portalFileId }, 1);
  for (const [table, filter] of [
    ['matters', { notion_id: fx.A.matterId }],
    ['clients', { notion_id: fx.A.clientId }],
    ['deliverables', { notion_id: fx.A.filingId }],
    ['deliverable_files', { deliverable_id: fx.A.filingId }],
    ['files', { notion_id: portalFileId }],
    ['files', { notion_id: fx.A.fileId }],
    ['hearings', { matter_id: fx.A.matterId }],
    ['meetings', { matter_id: fx.A.matterId }],
    ['exhibits', { matter_id: fx.A.matterId }],
    ['file_requests', { matter_id: fx.A.matterId }],
    ['engagement_signatures', { matter_id: fx.A.matterId }],
    ['invoices', { client_id: fx.A.clientId }],
    ['client_deposits', { client_id: fx.A.clientId }],
  ] as const) {
    await expectRows(`A-portal JWT reads nothing from its own ${table}`, Aportal, table, filter, 0);
  }
  await expectRows('A-portal JWT reads no invoice payment', Aportal, 'invoice_payments', { firm_id: fx.A.firmId }, 0);
  await expectRows('A-portal cannot see firm-B matter', Aportal, 'matters', { notion_id: fx.B.matterId }, 0);
  await expectRows('B-portal cannot see firm-A client row', Bportal, 'clients', { notion_id: fx.A.clientId }, 0);
  await expectWriteDenied('A-portal cannot update its own matter (portal is read-only)', Aportal, 'matters',
    { name: 'portal-hijacked' }, { notion_id: fx.A.matterId });
  {
    const forgedId = mintId('file');
    const { error } = await Aportal.from('files').insert({
      notion_id: forgedId, name: 'portal-forged', matter_id: fx.A.matterId,
      uploaded_by_client_user_id: aClientUser!.id, firm_id: fx.A.firmId,
    });
    const { data: landed } = await service.from('files').select('notion_id').eq('notion_id', forgedId);
    record('A-portal cannot insert a files row directly (uploads go through the service client)',
      !!error && (landed?.length ?? 0) === 0,
      error ? `inserted? ${landed?.length ?? 0}` : 'insert succeeded');
  }
  {
    const looseId = mintId('file');
    const { error } = await Aportal.from('files').insert({
      notion_id: looseId, name: 'portal-forged-loose', firm_id: fx.A.firmId,
    });
    const { data: landed } = await service.from('files').select('notion_id').eq('notion_id', looseId);
    record('A-portal cannot insert a matter-less files row', !!error && (landed?.length ?? 0) === 0,
      error ? `inserted? ${landed?.length ?? 0}` : 'insert succeeded');
  }

  console.log('── internal AI summaries are not the client\'s ──');
  const { data: briefFixture } = await service
    .from('matter_summaries').select('matter_id').eq('matter_id', fx.A.matterId);
  record('fixture: firm A\'s matter has an internal brief to protect', (briefFixture?.length ?? 0) === 1,
    `expected 1 brief row, got ${briefFixture?.length ?? 0}`);
  await expectRows('A-portal cannot read its own matter\'s internal brief', Aportal, 'matter_summaries',
    { matter_id: fx.A.matterId }, 0);
  await expectRows('A-portal cannot read its own matter\'s executive summary', Aportal, 'matter_exec_summaries',
    { matter_id: fx.A.matterId }, 0);
  await expectRows('A-lawyer reads own-firm executive summary', Al, 'matter_exec_summaries',
    { matter_id: fx.A.matterId }, 1);

  console.log('── leave approval ──');
  await expectWriteDenied('A-lawyer cannot approve their own leave', Al, 'leaves',
    { status: 'Approved', approved: true }, { notion_id: fx.A.leaveId });
  await expectRows('A-lawyer still reads their own leave', Al, 'leaves', { notion_id: fx.A.leaveId }, 1);
  await expectWriteDenied('B-lawyer cannot approve a firm-A leave', Bl, 'leaves',
    { status: 'Approved', approved: true }, { notion_id: fx.A.leaveId });
  {
    // The control: without it a broken fixture that refuses everyone would pass.
    const { data, error } = await Ap.from('leaves')
      .update({ status: 'Approved', approved: true }).eq('notion_id', fx.A.leaveId).select('notion_id');
    record('A-partner can approve a firm-A leave', !error && (data?.length ?? 0) === 1,
      error ? `error: ${error.message}` : `updated ${data?.length ?? 0} rows`);
  }

  console.log('── team self-service ──');
  {
    // team_self_update admits a person to their own row; team_guard_self_update
    // is what limits the columns. Only 42501 passes: a 0-row update would mean
    // the row filter refused, which says nothing about the guard.
    const lawyerId = fx.A.personIds['A-lawyer'];
    for (const [label, values] of [
      ['role to super_user', { role: 'super_user' }],
      ['monthly_salary', { monthly_salary: 999999 }],
      ['email', { email: 'probe-a-hijack@lumilex.test' }],
    ] as const) {
      const { error } = await Al.from('team').update(values).eq('person_id', lawyerId);
      record(`A-lawyer cannot change their own ${label}`, error?.code === '42501',
        error ? `expected 42501, got ${error.code}: ${error.message}` : 'update succeeded');
    }
    const { data: roleNow } = await service.from('team').select('role').eq('person_id', lawyerId).single();
    record('A-lawyer is still a lawyer after the attempts', roleNow?.role === 'lawyer',
      `role is ${roleNow?.role}`);
    // The control: the one column a person owns still saves.
    const { data, error } = await Al.from('team')
      .update({ nickname: 'probe-nick' }).eq('person_id', lawyerId).select('person_id');
    record('A-lawyer can change their own nickname', !error && (data?.length ?? 0) === 1,
      error ? `error: ${error.message}` : `updated ${data?.length ?? 0} rows`);
  }
  {
    // monthly_salary is withheld at the column level, which means every other
    // column has to be granted by name: a column added to team later is
    // unreadable through a JWT until it is. Read the live column set through
    // the service role so that gap fails here rather than in a page.
    for (const who of ['A-lawyer', 'A-finance'] as const) {
      const { error } = await clientFor(who).from('team').select('monthly_salary').limit(1);
      record(`${who} cannot read monthly_salary through PostgREST`, error?.code === '42501',
        error ? `expected 42501, got ${error.code}: ${error.message}` : 'salary was readable');
    }
    const { data: sample } = await service.from('team').select('*').eq('firm_id', fx.A.firmId).limit(1).single();
    const readable = Object.keys(sample ?? {}).filter((c) => c !== 'monthly_salary');
    const { data, error } = await Al.from('team').select(readable.join(',')).eq('firm_id', fx.A.firmId);
    record('A-lawyer reads every other team column', readable.length > 0 && !error && (data?.length ?? 0) > 0,
      error ? `error: ${error.message} — grant the new column to authenticated` : `read ${data?.length ?? 0} rows of ${readable.length} columns`);
  }

  console.log('── files ──');
  await expectRows('A-lawyer reads own-firm files row', Al, 'files', { notion_id: fx.A.fileId }, 1);
  await expectRows('B-lawyer cannot read firm-A files row', Bl, 'files', { notion_id: fx.A.fileId }, 0);

  console.log('── personal data ──');
  await expectRows('B-lawyer cannot read firm-A user_preferences', Bl, 'user_preferences',
    { email: 'probe-a-lawyer@lumilex.test' }, 0);
  await expectRows('A-lawyer reads own user_preferences row', Al, 'user_preferences',
    { email: 'probe-a-lawyer@lumilex.test' }, 1);

  // The same address, in two firms. `user_preferences` was keyed on `email`
  // alone until 20260824_firm_upsert_conflict_targets_wave5.sql, so one address
  // could hold exactly one preferences row on the whole instance: a person who
  // works at two tenants could have notification settings at only one of them,
  // and whichever firm wrote second took the first one's row over. The key is
  // now (firm_id, email) — this is what keeps it that way.
  {
    const shared = 'probe-a-lawyer@lumilex.test';
    const { error } = await service
      .from('user_preferences')
      .insert({ email: shared, firm_id: fx.B.firmId });
    record(
      'same address holds a user_preferences row in both firms',
      !error,
      error ? `insert rejected: ${error.message}` : 'firm A and firm B rows coexist',
    );
    await expectRows(
      "A-lawyer still reads exactly one row for that address — its own firm's",
      Al, 'user_preferences', { email: shared }, 1,
    );
  }

  console.log('── firms table ──');
  await expectRows('A-lawyer reads own firms row', Al, 'firms', { id: fx.A.firmId }, 1);
  await expectRows('A-lawyer cannot read firm-B firms row', Al, 'firms', { id: fx.B.firmId }, 0);

  console.log('── cross-firm insert ──');
  await expectInsertNotCrossFirm('A-lawyer cannot insert a task stamped with firm B', Al, 'tasks', {
    notion_id: mintId('task'), name: 'Probe wrong-firm task', matter_id: fx.A.matterId,
    matter_name: `Probe Matter A`, status: 'Not started', done: false,
    assignee_ids: [fx.A.personIds['A-lawyer']], firm_id: fx.B.firmId,
  }, 'notion_id', fx.B.firmId);
  // The onboarding gate, through the app's own path. Tenant tables used to carry
  // a dev-firm column DEFAULT, so an insert that forgot firm_id was silently
  // filed under firm 1 instead of failing.
  // 20260823_drop_transitional_firm_defaults.sql removed it. This is the
  // authed-client half — PostgREST, RLS active, one representative table — and
  // proves the refusal reaches a real caller. The catalog-wide half below is
  // what covers every other table.
  {
    const row = {
      notion_id: mintId('task'), name: 'Probe default-firm task', matter_id: fx.A.matterId,
      matter_name: `Probe Matter A`, status: 'Not started', done: false,
      assignee_ids: [fx.A.personIds['A-lawyer']],
    };
    const { error } = await Al.from('tasks').insert(row);
    if (error) {
      record('insert omitting firm_id is rejected (authed client, tasks)', true, `error (ok): ${error.message}`);
    } else {
      const { data: landed } = await service
        .from('tasks').select('firm_id').eq('notion_id', row.notion_id).maybeSingle();
      await service.from('tasks').delete().eq('notion_id', row.notion_id);
      record('insert omitting firm_id is rejected (authed client, tasks)', false,
        `insert succeeded; a column default stamped firm_id=${landed?.firm_id}`);
    }
  }

  await firmIdRefusalSweep();

  await invoiceProbe(clientFor('A-finance'), clientFor('B-finance'));

  console.log('── partner billing access ──');
  // The finance routes behind a partner's Billing Review read through the
  // signed-in client; without a partner policy every read came back empty and
  // the review showed zero fees. Runs after invoiceProbe so both firms hold an
  // invoice and a billing config for the deny checks to fail to reach.
  {
    const countOf = async (client: SupabaseClient, table: string, firmId: string) => {
      const { data, error } = await client.from(table).select('firm_id').eq('firm_id', firmId);
      return error ? -1 : (data?.length ?? 0);
    };
    const ownInvoices = await countOf(Ap, 'invoices', fx.A.firmId);
    record('A-partner reads own-firm invoices', ownInvoices > 0, `got ${ownInvoices} rows`);
    const ownConfigs = await countOf(Ap, 'matter_billing_configs', fx.A.firmId);
    record('A-partner reads own-firm matter billing configs', ownConfigs > 0, `got ${ownConfigs} rows`);
  }
  await expectRows('A-partner cannot read firm-B invoices', Ap, 'invoices', { firm_id: fx.B.firmId }, 0);
  await expectRows('A-partner cannot read firm-B matter billing configs', Ap, 'matter_billing_configs',
    { firm_id: fx.B.firmId }, 0);
  await expectWriteDenied('A-partner cannot edit an invoice (finance-written)', Ap, 'invoices',
    { status: 'void' }, { firm_id: fx.A.firmId });
  await expectRows('A-lawyer still cannot read invoices', Al, 'invoices', { firm_id: fx.A.firmId }, 0);

  console.log('── deny-by-default ──');
  await expectRows('A-partner cannot read audit_log', Ap, 'audit_log', { firm_id: fx.A.firmId }, 0);

  console.log('── firm_integrations (feature flags + sealed credentials) ──');
  // Deny-by-default: nobody reads it through PostgREST, not even their own
  // firm's row. Flags are resolved server-side through getServiceDbForFirm,
  // and credentials_enc must never be reachable from a browser session.
  await expectRows('B-lawyer cannot read firm-A firm_integrations', Bl, 'firm_integrations',
    { firm_id: fx.A.firmId }, 0);
  await expectRows('A-partner cannot read own-firm firm_integrations', Ap, 'firm_integrations',
    { firm_id: fx.A.firmId }, 0);
  await expectRows('A-lawyer cannot read own-firm firm_integrations', Al, 'firm_integrations',
    { firm_id: fx.A.firmId }, 0);
  await expectRows('A-portal cannot read firm_integrations', Aportal, 'firm_integrations',
    { firm_id: fx.A.firmId }, 0);
  await expectWriteDenied('B-lawyer cannot enable a feature for firm A', Bl, 'firm_integrations',
    { enabled: false }, { firm_id: fx.A.firmId, feature: 'sharepoint' });
  await expectWriteDenied('A-partner cannot enable a feature for its own firm', Ap,
    'firm_integrations', { enabled: false }, { firm_id: fx.A.firmId, feature: 'sharepoint' });

  console.log('── calendar_feed_tokens (bearer feed credentials) ──');
  // Deny-by-default, and for a sharper reason than most: the token is not a
  // pointer to protected data, it IS the access. A colleague who can select it
  // reads that person's calendar without ever authenticating as them, which is
  // exactly why it does not live on `team` — team_authenticated_select would
  // hand every row to every member of the firm.
  await expectRows('B-lawyer cannot read firm-A calendar_feed_tokens', Bl, 'calendar_feed_tokens',
    { firm_id: fx.A.firmId }, 0);
  await expectRows('A-partner cannot read own-firm calendar_feed_tokens', Ap, 'calendar_feed_tokens',
    { firm_id: fx.A.firmId }, 0);
  await expectRows('A-lawyer cannot read even their own calendar_feed_tokens', Al,
    'calendar_feed_tokens', { firm_id: fx.A.firmId }, 0);
  await expectRows('A-portal cannot read calendar_feed_tokens', Aportal, 'calendar_feed_tokens',
    { firm_id: fx.A.firmId }, 0);
  await expectWriteDenied('A-lawyer cannot mint themselves a feed token', Al,
    'calendar_feed_tokens', { token: 'forged' }, { firm_id: fx.A.firmId });

  await viewProbe(Ap, Al, Bl, Aportal, Bportal);
  await libraryProbe(Ap, Al, Bl);
  await keywordSearchProbe(Al);
  await legalCodesProbe(Ap, Al, Bl, Aportal);

  console.log('── anon ──');
  const anon = createClient(URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await expectRows('anon cannot read files', anon, 'files', {}, 0);
  await expectRows('anon cannot read firms', anon, 'firms', {}, 0);
  await expectRows('anon cannot read firm_integrations', anon, 'firm_integrations', {}, 0);
  await expectRows('anon cannot read calendar_feed_tokens', anon, 'calendar_feed_tokens', {}, 0);

  console.log('── call_app_api (the cron-secret webhook helpers) ──');
  // Both helpers send `Authorization: Bearer <cron_secret>` to
  // `app_base_url || path`. Callable through PostgREST, they let anyone with
  // the anon key invoke every CRON_SECRET route with any firmId — or, with a
  // path of `@attacker.example/`, post the secret itself to another host.
  // 20260926_revoke_call_app_api.sql took EXECUTE from every API role; the
  // triggers reach them as their SECURITY DEFINER owner.
  for (const [who, client] of [['anon', anon], ['A-lawyer', Al], ['A-portal', Aportal]] as const) {
    await expectRpcDenied(`${who} cannot call call_app_api_post`, client, 'call_app_api_post',
      { path: '/x', body: {} });
    await expectRpcDenied(`${who} cannot call call_app_api`, client, 'call_app_api', { path: '/x' });
  }
  // The control: the revoke must not break the triggers that are the helpers'
  // whole reason to exist. webhook_file_uploaded() fires on a file_urls change
  // and was SECURITY INVOKER until the same migration, so an authed staff
  // upload ran call_app_api as `authenticated` — after the revoke that update
  // would raise 42501 here, which is the "+ Add button is broken" shape. The
  // trigger does queue two real pg_net requests at app_base_url for this
  // disposable firm; the AI and SharePoint gates refuse a probe firm.
  {
    const { data, error } = await Al.from('files')
      .update({ file_urls: [{ url: 'probe://call-app-api-control' }] })
      .eq('notion_id', fx.A.fileId).select('notion_id');
    record('A-lawyer file_urls update fires the webhook trigger without error', !error && data?.length === 1,
      error ? `${error.code}: ${error.message}` : `updated ${data?.length ?? 0} rows, expected 1`);
  }

  // The fixtures are keyed on fixed slugs and fixed emails, which is what lets
  // the opening teardown clean up after a crashed run — and what makes two
  // concurrent runs mutually destructive: the second one's teardown deletes the
  // first one's firms, auth users and rows out from under it. The first then
  // fails with 42501s and empty reads that look like RLS regressions and are
  // not. A firm row's id can only change for a fixed slug if something
  // re-provisioned it, so this tells the two apart.
  {
    const { data: firms } = await service.from('firms').select('id, slug').in('slug', ['probe-a', 'probe-b']);
    const byslug = Object.fromEntries((firms ?? []).map((f) => [f.slug as string, f.id as string]));
    const sameFirms = byslug['probe-a'] === fx.A.firmId && byslug['probe-b'] === fx.B.firmId;
    // The firm rows alone are not canary enough: the colliding run deletes
    // children first and can then fail to delete the firm itself (an FK from a
    // row this run inserted in between), leaving the firm standing over a
    // gutted fixture set. `firm_invoice_settings` is written once at
    // provisioning and nothing under test deletes it, so its absence means
    // something outside this run swept the firm.
    const { count } = await service
      .from('firm_invoice_settings')
      .select('firm_id', { count: 'exact', head: true })
      .in('firm_id', [fx.A.firmId, fx.B.firmId]);
    record('the fixtures this run provisioned are still its own', sameFirms && count === 2,
      'another rls-probe run tore them down mid-flight — every other failure above is ' +
      'that, not a regression. Re-run serially. ' +
      `provisioned A=${fx.A.firmId} B=${fx.B.firmId}; found A=${byslug['probe-a'] ?? '(gone)'} ` +
      `B=${byslug['probe-b'] ?? '(gone)'}; surviving firm_invoice_settings rows: ${count ?? 0}/2`);
  }

  console.log('── teardown ──');
  await teardown();

  const failures = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failures.length}/${checks.length} checks pass`);
  if (failures.length > 0) process.exit(1);
}

async function teardown() {
  const { data: firms } = await service.from('firms').select('id').in('slug', ['probe-a', 'probe-b']);
  const firmIds = (firms ?? []).map((f) => f.id as string);

  // The invoice pipeline uploads a letter and two PDFs under the firm's own
  // storage prefix — rows are not the only thing this probe creates. Sweep the
  // ids this run minted as well as the ones the slugs resolve to now: they are
  // the same set in the normal case, and differ exactly when something deleted
  // our `firms` row before we got here, which is when the objects would
  // otherwise be orphaned with nothing naming them.
  for (const firmId of new Set([...firmIds, ...provisionedFirmIds])) {
    await removeUnder('files', firmId);
  }

  if (firmIds.length > 0) {
    for (const table of FIXTURE_TABLES) {
      const { error } = await service.from(table).delete().in('firm_id', firmIds);
      if (error && !/does not exist/.test(error.message)) {
        throw new Error(`teardown of ${table} failed: ${error.message}`);
      }
    }
    const { error: firmErr } = await service.from('firms').delete().in('id', firmIds);
    if (firmErr) throw new Error(`teardown of firms failed (fixture table missing from FIXTURE_TABLES?): ${firmErr.message}`);
  }
  const { data: list } = await service.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list?.users ?? []) {
    if (u.email?.startsWith('probe-') && u.email.endsWith('@lumilex.test')) {
      await service.auth.admin.deleteUser(u.id);
    }
  }
}

main().catch(async (err) => {
  console.error(err);
  try { await teardown(); } catch { /* best effort */ }
  process.exit(1);
});
