import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(), getClientIP: () => 'test' }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => fake.db }));
vi.mock('@/lib/storage-sign', () => ({ signStoragePaths: async () => new Map() }));

import { logAudit } from '@/lib/audit';
import { loadPortalCompany } from './companies';
import { loadPortalTrademark } from './trademarks';
import {
  PORTAL_HIDDEN_ACTION,
  PORTAL_PREVIEW_ACTION,
  PORTAL_SHOWN_ACTION,
  canSwitchPortal,
  changePortalVisible,
  parsePortalSwitch,
  portalSwitchPreview,
  readinessBlockers,
  switchTier,
} from './switch-access';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const FAILED = { data: null, error: { message: 'connection refused' } };

function fakeDb(tables: Tables, broken: { reads?: string[]; writes?: boolean } = {}) {
  const updates: { table: string; patch: Row; id: unknown }[] = [];
  const from = (table: string) => {
    const tests: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const rows = () => (tables[table] ?? []).filter((r) => tests.every((t) => t(r)));
    const run = () => {
      if (patch && broken.writes) return FAILED;
      if (!patch && broken.reads?.includes(table)) return FAILED;
      if (patch) {
        updates.push({ table, patch, id: rows()[0]?.id });
        for (const r of rows()) Object.assign(r, patch);
        return { data: null, error: null };
      }
      return { data: rows(), error: null };
    };
    const chain = {
      select: () => chain,
      update: (p: Row) => ((patch = p), chain),
      eq: (c: string, v: unknown) => (tests.push((r) => r[c] === v), chain),
      neq: (c: string, v: unknown) => (tests.push((r) => r[c] !== v), chain),
      in: (c: string, v: unknown[]) => (tests.push((r) => v.includes(r[c])), chain),
      is: (c: string, v: unknown) => (tests.push((r) => (r[c] ?? null) === v), chain),
      gte: (c: string, v: string) => (tests.push((r) => String(r[c]) >= v), chain),
      contains: (c: string, v: unknown[]) => (tests.push((r) => v.every((x) => ((r[c] as unknown[]) ?? []).includes(x))), chain),
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => (broken.reads?.includes(table) ? FAILED : { data: rows()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => Promise.resolve(run()).then(ok),
    };
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, updates };
}

const LAWYER = { firmId: 'firm-1', personId: 'p-lawyer', role: 'lawyer' };

function world(over: Partial<Tables> = {}): Tables {
  return {
    corporations: [{ id: 'co-1', approved_name: 'Sample Co', proposed_names: [], portal_visible: false, client_id: 'cl-1', engaging_client_id: null }],
    trademarks: [{ id: 'tm-1', mark: 'SAMPLE', portal_visible: false, client_id: 'cl-1', classes: [9], origin: 'national' }],
    matter_subjects: [
      { subject_id: 'co-1', matter_id: 'm-1' },
      { subject_id: 'tm-1', matter_id: 'm-1' },
    ],
    matters: [
      { notion_id: 'm-1', name: 'Covering matter', client_id: 'cl-1', team_person_ids: ['p-lawyer', 'p-finance', 'p-liaison'] },
      { notion_id: 'm-2', name: 'Other matter', client_id: 'cl-1', team_person_ids: ['p-client-team'] },
      { notion_id: 'm-3', name: 'Unrelated', client_id: 'cl-2', team_person_ids: ['p-elsewhere'] },
    ],
    clients: [
      { notion_id: 'cl-1', name: 'Sample Client', relationship_partner_id: 'p-relationship' },
      { notion_id: 'cl-2', name: 'Other Client', relationship_partner_id: null },
    ],
    client_users: [{ client_id: 'cl-1', active: true }],
    subject_status: [
      { subject_id: 'co-1', name: 'Sample Co', focus: [], team: [], type: 'corporation' },
      { subject_id: 'tm-1', name: 'SAMPLE', lifecycle_status: 'Pending', team: [], type: 'trademark' },
    ],
    subject_status_items: [
      { subject_id: 'co-1', item_key: 'gis', track: 'annual', label: 'GIS', detail: null, state: 'overdue', due_date: '2026-01-30', provisional: false },
    ],
    corporation_files: [],
    file_requests: [],
    audit_log: [],
    ...over,
  };
}

const previewViewed = (id: string, kind = 'Corporation', personId = LAWYER.personId, at = new Date().toISOString()): Row => ({
  entity_type: kind,
  entity_id: id,
  action: PORTAL_PREVIEW_ACTION,
  performed_by: personId,
  created_at: at,
});

beforeEach(() => vi.mocked(logAudit).mockClear());

describe('switchTier', () => {
  it.each([
    ['admin', 'any'],
    ['super_user', 'any'],
    ['partner', 'any'],
    ['lawyer', 'team'],
    ['finance', 'none'],
    ['liaison_officer', 'none'],
    ['chief_liaison_officer', 'none'],
    [undefined, 'none'],
  ])('%s is %s', (role, tier) => expect(switchTier(role)).toBe(tier));
});

describe('parsePortalSwitch', () => {
  it('leaves a body that does not touch the switch', () => expect(parsePortalSwitch({ notes: 'x' })).toBeNull());
  it('reads either spelling', () => {
    expect(parsePortalSwitch({ portalVisible: true })).toEqual({ visible: true });
    expect(parsePortalSwitch({ portal_visible: false })).toEqual({ visible: false });
  });
  it('refuses a value that is not a boolean', () => expect(parsePortalSwitch({ portalVisible: 'yes' })).toHaveProperty('error'));
  it('refuses the switch mixed with other edits', () => expect(parsePortalSwitch({ portalVisible: true, notes: 'x' })).toHaveProperty('error'));
});

describe('readinessBlockers', () => {
  it('is empty when a covering client has a user and a preview', () => {
    expect(readinessBlockers('company', { coveringClients: 1, activeUsers: 1, previews: 1 })).toEqual([]);
  });
  it('says so when no client covers it, and nothing else', () => {
    const blockers = readinessBlockers('mark', { coveringClients: 0, activeUsers: 0, previews: 0 });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/matter covers this mark/);
  });
  it('names a missing portal user and a missing status separately', () => {
    expect(readinessBlockers('company', { coveringClients: 1, activeUsers: 0, previews: 1 })[0]).toMatch(/no active portal user/);
    expect(readinessBlockers('company', { coveringClients: 1, activeUsers: 1, previews: 0 })[0]).toMatch(/status has not been worked out/);
  });
});

describe('canSwitchPortal', () => {
  const can = async (personId: string, role: string, tables = world()) => {
    const result = await canSwitchPortal(fakeDb(tables).db, 'corporation', 'co-1', { firmId: 'firm-1', personId, role });
    return result.ok ? result.canSwitch : result;
  };

  it('admits a lawyer on a covering matter', async () => expect(await can('p-lawyer', 'lawyer')).toBe(true));
  it("admits a lawyer on another of the client's matters", async () => expect(await can('p-client-team', 'lawyer')).toBe(true));
  it("admits a lawyer who is the client's relationship partner", async () => expect(await can('p-relationship', 'lawyer')).toBe(true));
  it('refuses a lawyer off the team', async () => expect(await can('p-elsewhere', 'lawyer')).toBe(false));
  it('admits a partner off the team', async () => expect(await can('p-elsewhere', 'partner')).toBe(true));
  it('admits an admin', async () => expect(await can('p-elsewhere', 'admin')).toBe(true));
  it('refuses finance and liaison even on the team', async () => {
    expect(await can('p-finance', 'finance')).toBe(false);
    expect(await can('p-liaison', 'liaison_officer')).toBe(false);
  });
  it('is false for a record that does not exist', async () => {
    expect(await canSwitchPortal(fakeDb(world()).db, 'corporation', 'nope', LAWYER)).toEqual({ ok: true, canSwitch: false });
  });
  it('says it could not check when a read fails, rather than no', async () => {
    const off = { firmId: 'firm-1', personId: 'p-elsewhere', role: 'lawyer' };
    expect(await canSwitchPortal(fakeDb(world(), { reads: ['clients'] }).db, 'corporation', 'co-1', off)).toMatchObject({ ok: false, status: 503, code: 'portal_check_failed' });
    expect(await canSwitchPortal(fakeDb(world(), { reads: ['matter_subjects'] }).db, 'corporation', 'co-1', off)).toMatchObject({ status: 503 });
  });
  it('still admits someone another read already found on the team', async () => {
    expect(await canSwitchPortal(fakeDb(world(), { reads: ['clients'] }).db, 'corporation', 'co-1', LAWYER)).toEqual({ ok: true, canSwitch: true });
  });
});

describe('changePortalVisible', () => {
  it('switches on with a portal user and a viewed preview, on the column alone, and audits who', async () => {
    const { db, updates } = fakeDb(world({ audit_log: [previewViewed('co-1')] }));
    expect(await changePortalVisible(db, 'corporation', 'co-1', true, LAWYER, '10.0.0.1')).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('corporations');
    expect(Object.keys(updates[0].patch).sort()).toEqual(['portal_visible', 'updated_at']);
    expect(updates[0].patch.portal_visible).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Corporation',
        entityId: 'co-1',
        action: PORTAL_SHOWN_ACTION,
        fieldChanged: 'portal_visible',
        oldValue: 'false',
        newValue: 'true',
        performedBy: 'p-lawyer',
        ipAddress: '10.0.0.1',
      }),
    );
  });

  it('refuses when the client has no active portal user', async () => {
    const { db, updates } = fakeDb(world({ client_users: [{ client_id: 'cl-1', active: false }], audit_log: [previewViewed('co-1')] }));
    expect(await changePortalVisible(db, 'corporation', 'co-1', true, LAWYER)).toMatchObject({ ok: false, status: 409, code: 'portal_not_ready' });
    expect(updates).toHaveLength(0);
  });

  it('counts only a portal user of a covering client', async () => {
    const { db } = fakeDb(world({ client_users: [{ client_id: 'cl-2', active: true }], audit_log: [previewViewed('co-1')] }));
    expect(await changePortalVisible(db, 'corporation', 'co-1', true, LAWYER)).toMatchObject({ code: 'portal_not_ready' });
  });

  it.each([
    ['nobody opened it', []],
    ['someone else opened it', [previewViewed('co-1', 'Corporation', 'p-other')]],
    ['it was another record', [previewViewed('co-9')]],
    ['it was a mark of the same id', [previewViewed('co-1', 'Trademark')]],
    ['it was long ago', [previewViewed('co-1', 'Corporation', LAWYER.personId, '2020-01-01T00:00:00.000Z')]],
  ])('refuses switching on when %s', async (_why, audit_log) => {
    const { db, updates } = fakeDb(world({ audit_log }));
    expect(await changePortalVisible(db, 'corporation', 'co-1', true, LAWYER)).toMatchObject({ ok: false, code: 'portal_preview_required' });
    expect(updates).toHaveLength(0);
  });

  it('refuses a lawyer off the team, with nothing written or audited', async () => {
    const { db, updates } = fakeDb(world({ audit_log: [previewViewed('co-1', 'Corporation', 'p-elsewhere')] }));
    const result = await changePortalVisible(db, 'corporation', 'co-1', true, { firmId: 'firm-1', personId: 'p-elsewhere', role: 'lawyer' });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(updates).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('switches off through the same gate, without the readiness check', async () => {
    const tables = world({ client_users: [] });
    tables.corporations[0].portal_visible = true;
    const refused = fakeDb(tables);
    expect(await changePortalVisible(refused.db, 'corporation', 'co-1', false, { firmId: 'firm-1', personId: 'p-finance', role: 'finance' })).toMatchObject({ status: 403 });
    expect(refused.updates).toHaveLength(0);

    const allowed = fakeDb(tables);
    expect(await changePortalVisible(allowed.db, 'corporation', 'co-1', false, LAWYER)).toEqual({ ok: true });
    expect(allowed.updates[0].patch.portal_visible).toBe(false);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: PORTAL_HIDDEN_ACTION, oldValue: 'true', newValue: 'false' }));
  });

  it('writes and audits nothing when the switch is already there', async () => {
    const tables = world();
    tables.corporations[0].portal_visible = true;
    const { db, updates } = fakeDb(tables);
    expect(await changePortalVisible(db, 'corporation', 'co-1', true, LAWYER)).toEqual({ ok: true });
    expect(updates).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('works for a mark, on its own table', async () => {
    const { db, updates } = fakeDb(world({ audit_log: [previewViewed('tm-1', 'Trademark')] }));
    expect(await changePortalVisible(db, 'trademark', 'tm-1', true, LAWYER)).toEqual({ ok: true });
    expect(updates[0].table).toBe('trademarks');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'Trademark', entityName: 'SAMPLE' }));
  });

  it('is not found for a missing record', async () => {
    expect(await changePortalVisible(fakeDb(world()).db, 'trademark', 'nope', true, LAWYER)).toMatchObject({ status: 404 });
  });

  it.each(['client_users', 'audit_log'])('refuses with "could not check" when the %s read fails', async (table) => {
    const { db, updates } = fakeDb(world({ audit_log: [previewViewed('co-1')] }), { reads: [table] });
    expect(await changePortalVisible(db, 'corporation', 'co-1', true, LAWYER)).toMatchObject({ ok: false, status: 503, code: 'portal_check_failed' });
    expect(updates).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('keeps the database message out of a failed write', async () => {
    const { db } = fakeDb(world({ audit_log: [previewViewed('co-1')] }), { writes: true });
    const result = await changePortalVisible(db, 'corporation', 'co-1', true, LAWYER);
    expect(result).toMatchObject({ ok: false, status: 500, code: 'portal_switch_failed' });
    expect(JSON.stringify(result)).not.toContain('connection refused');
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe('portalSwitchPreview', () => {
  it('builds what the client will see while the switch is still off, and records the viewing', async () => {
    const { db } = fakeDb(world());
    const result = await portalSwitchPreview(db, 'corporation', 'co-1', LAWYER);
    if (!result.ok) throw new Error(result.error);
    expect(result.preview.ready).toBe(true);
    expect(result.preview.audiences).toHaveLength(1);
    expect(result.preview.audiences[0]).toMatchObject({ clientId: 'cl-1', clientName: 'Sample Client', activeUsers: 1 });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: PORTAL_PREVIEW_ACTION, entityId: 'co-1', performedBy: 'p-lawyer' }));
  });

  it("goes through forClient: a past-due item is in progress, with no date", async () => {
    const { db } = fakeDb(world());
    const result = await portalSwitchPreview(db, 'corporation', 'co-1', LAWYER);
    if (!result.ok) throw new Error(result.error);
    const detail = result.preview.audiences[0].detail;
    if (!('company' in detail)) throw new Error('expected a company');
    expect(detail.items[0]).toMatchObject({ state: 'in_progress', dueDate: null });
    expect(JSON.stringify(detail)).not.toContain('2026-01-30');
    expect(JSON.stringify(detail)).not.toContain('overdue');
  });

  it('leaves the portal itself shut until the switch is on', async () => {
    const { db } = fakeDb(world());
    expect(await loadPortalCompany(db, 'cl-1', 'co-1')).toBeNull();
    fake.db = db;
    expect(await loadPortalTrademark(db, 'cl-1', 'tm-1')).toBeNull();
  });

  it('previews a mark', async () => {
    const { db } = fakeDb(world());
    fake.db = db;
    const result = await portalSwitchPreview(db, 'trademark', 'tm-1', LAWYER);
    if (!result.ok) throw new Error(result.error);
    expect(result.preview.audiences[0].detail).toHaveProperty('mark.mark', 'SAMPLE');
  });

  it('reports a client with no portal user as not ready, and still shows the preview', async () => {
    const { db } = fakeDb(world({ client_users: [] }));
    const result = await portalSwitchPreview(db, 'corporation', 'co-1', LAWYER);
    if (!result.ok) throw new Error(result.error);
    expect(result.preview.ready).toBe(false);
    expect(result.preview.blockers[0]).toMatch(/no active portal user/);
    expect(result.preview.audiences).toHaveLength(1);
  });

  it('does not count a preview that cannot be confirmed as seen', async () => {
    for (const blocked of [world({ client_users: [] }), world({ subject_status: [] })]) {
      const result = await portalSwitchPreview(fakeDb(blocked).db, 'corporation', 'co-1', LAWYER);
      if (!result.ok) throw new Error(result.error);
      expect(result.preview.ready).toBe(false);
    }
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('says it could not check, rather than that the client has no user, when a read fails', async () => {
    const { db } = fakeDb(world(), { reads: ['client_users'] });
    expect(await portalSwitchPreview(db, 'corporation', 'co-1', LAWYER)).toMatchObject({ ok: false, status: 503 });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('is not ready when no matter covers the subject', async () => {
    const { db } = fakeDb(world({ matter_subjects: [] }));
    const result = await portalSwitchPreview(db, 'corporation', 'co-1', { firmId: 'firm-1', personId: 'p-admin', role: 'admin' });
    if (!result.ok) throw new Error(result.error);
    expect(result.preview).toMatchObject({ ready: false, audiences: [] });
  });

  it('shows nothing to, and records nothing for, someone who may not switch', async () => {
    const { db } = fakeDb(world());
    expect(await portalSwitchPreview(db, 'corporation', 'co-1', { firmId: 'firm-1', personId: 'p-finance', role: 'finance' })).toMatchObject({ ok: false, status: 403 });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
