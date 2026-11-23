import * as crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase';
import { getServiceDbForFirm, firmStoragePath } from '../../lib/tenancy/service-db';
import { mintId } from '../../lib/ids';
import { addDays, addMonths, manilaDayOfWeek, manilaHour, manilaToday, MANILA_OFFSET, toManilaWallClock } from '../../lib/dates';
import {
  DELIVERABLE_STATUS,
  statusesForType,
  type DeliverableStatus,
} from '../../lib/deliverable-status';
import { TASK_STATUS } from '../../lib/task-status';
import { MATTER_STATUS } from '../../lib/matter-status';
import { HEARING_STATUSES } from '../../lib/hearing-status';
import { fetchMatterTypeCodes } from '../../lib/enum-options';
import { DTR_TASKS } from '../../lib/validation';
import type { FirmProfileContent } from '../../lib/firm-profile/types';
import type { DemoPersonaKey } from '../../lib/demo/personas';
import {
  CLIENTS,
  CORPORATE_OFFICERS,
  DTYPE,
  FIRM,
  HOURLY_RATES,
  MATTERS,
  STAFF,
  STAFF_DOMAIN,
  type ClientSeed,
  type MatterSeed,
  type StaffSeed,
  type WorkSeed,
} from './dataset';
import { composeDocument, incomingBody } from './pleading-text';
import { DOCX_TYPE, PDF_TYPE, longDate, renderDocx, renderPdf, renderRecordPdf, stampFiledCopy } from './documents';
import { FILED_VERSION_ACTION, wasFiledWithAuthority } from '../../lib/portal/deliverable-visibility';
import { renderFixtureDocx, renderFixturePdf } from './affidavit-fixture';

/**
 * Fills the demo firm with a working practice: staff, clients, matters,
 * deliverables with their version files, hearings, meetings, tasks, time,
 * leave, expenses, invoices and collections, errands, corporate and trademark
 * records, incoming court records, announcements, notifications and chat.
 *
 * Called by scripts/demo/build.ts after provisioning; env is already loaded.
 * Every tenant-table write goes through getServiceDbForFirm(firmId), every
 * storage key through firmStoragePath(), and nothing here calls a model.
 *
 * Dates are relative to today in Manila, so a rebuild always looks current.
 *
 * Three database triggers post to the app over pg_net: new deliverables,
 * hearings and incoming files queue a matter-summary refresh, and a version
 * uploaded to a finalized deliverable queues its analysis. The AI pass is a
 * separate step, so those rows are written without the column the trigger
 * keys on — `matter_id` is set in a follow-up update, and version rows land
 * before the deliverables they belong to — and nothing is sent anywhere.
 * `drafter_ids` follows the same path so the new-deliverable trigger does not
 * bury the personas' notifications under a hundred "new deliverable" rows.
 */

type Row = Record<string, unknown>;
type TaskName = (typeof DTR_TASKS)[number];

const S = DELIVERABLE_STATUS;
const [HEARING_SCHEDULED, HEARING_ATTENDED, HEARING_POSTPONED, HEARING_CANCELLED] = HEARING_STATUSES;

// ── Small utilities ──────────────────────────────────────────────────

/** Deterministic, so a rebuild produces the same demo. */
class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed;
  }
  next(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state / 0x7fffffff;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function sanitizeName(name: string): string {
  return name
    .replace(/[\[\](){}]/g, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function slug(s: string, max = 60): string {
  return sanitizeName(s.replace(/[—–]/g, '-')).slice(0, max).replace(/_$/, '');
}

/** An instant as an ISO string on the Manila clock. */
function isoManila(ms: number): string {
  return `${toManilaWallClock(ms)}${MANILA_OFFSET}`;
}

function peso(n: number): string {
  return `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function pool<T>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

// ── Records the seed keeps in memory ─────────────────────────────────

interface Person {
  seed: StaffSeed;
  personId: string;
  name: string;
  email: string;
  position: string;
  initials: string;
}

interface ClientRec {
  seed: ClientSeed;
  id: string;
}

interface MatterRec {
  seed: MatterSeed;
  id: string;
  code: string;
  client: ClientRec;
  team: Person[];
  opened: string;
}

interface Step {
  label: string;
  from: DeliverableStatus;
  to: DeliverableStatus;
  by: 'drafter' | 'reviewer';
  comment?: string;
  /** `filedCopy`: the finalized PDF again, stamped as received or sent out. */
  version?: { kind: 'docx' | 'pdf'; action: string; filedCopy?: true };
}

interface DeliverableRec {
  id: string;
  work: WorkSeed;
  matter: MatterRec;
  status: DeliverableStatus;
  drafters: Person[];
  reviewers: Person[];
  created: string;
  due: string | null;
  dateDone: string | null;
  revisions: number;
  steps: { step: Step; at: string }[];
}

interface HearingRec {
  id: string;
  matter: MatterRec;
  name: string;
  day: string;
  at: string;
  status: string;
  attendees: Person[];
}

interface DtrRec {
  row: Row;
  person: Person;
  matter: MatterRec;
  day: string;
  minutes: number;
  billable: boolean;
}

const REVISION_NOTES = [
  'Tighten the statement of facts — paragraph 4 repeats paragraph 2.',
  'Please add the verification and certification against forum shopping before this goes out.',
  'Check the computation in Annex B; it does not tie to the demand letter.',
  'Good draft. One more pass on the prayer and the dates in the second section.',
  'Cite the contract clause directly instead of paraphrasing it.',
  'Shorten the discussion; the client wants a two-page answer.',
];

const COMMENTS = [
  'Client confirmed the figures in the annexes this morning.',
  'Uploaded the signed verification page.',
  'Liaison will file first thing tomorrow — please keep the originals in the red folder.',
  'Can we move the exhibits list to a separate page?',
  'Noted. Will revise and re-upload before 5 pm.',
  'Please loop in the client contact once the draft is final.',
];

// ── The seed ─────────────────────────────────────────────────────────

class DemoSeeder {
  private readonly db: SupabaseClient;
  private readonly rng = new Rng(20260930);
  private readonly today = manilaToday();
  /**
   * The most recent day work can already have happened on: today once the
   * office is open, yesterday before that — so a build at 2 am does not show
   * a day's filings and time entries already logged.
   */
  private readonly recent = manilaHour() >= 10 ? 0 : 1;
  /** The last day with a full day of time logged. */
  private readonly lastLoggedDay = addDays(manilaToday(), manilaHour() >= 17 ? 0 : -1);
  private readonly counts = new Map<string, number>();
  private storageObjects = 0;

  private readonly people = new Map<string, Person>();
  private readonly clients = new Map<string, ClientRec>();
  private readonly matters: MatterRec[] = [];
  private readonly deliverables: DeliverableRec[] = [];
  private readonly hearings: HearingRec[] = [];
  private readonly lastActivity = new Map<string, number>();
  private readonly approvedLeave = new Map<string, Set<string>>();
  private dtr: DtrRec[] = [];
  personas = {} as Record<DemoPersonaKey, string>;

  constructor(private readonly firmId: string) {
    this.db = getServiceDbForFirm(firmId);
  }

  // ── Plumbing ──

  private day(offset: number): string {
    return addDays(this.today, offset);
  }

  /** Move a day off the weekend, forward for future dates and back for past ones. */
  private weekday(day: string, direction: 1 | -1 = 1): string {
    let d = day;
    while (manilaDayOfWeek(d) === 0 || manilaDayOfWeek(d) === 6) d = addDays(d, direction);
    return d;
  }

  private at(day: string, hour: number, minute = 0): string {
    return `${day}T${pad2(hour)}:${pad2(minute)}:00${MANILA_OFFSET}`;
  }

  /** A timestamp that has already happened. */
  private past(day: string, hour: number, minute = 0): string {
    return this.clampPast(this.at(day, hour, minute));
  }

  private clampPast(iso: string): string {
    const ceiling = Date.now() - 10 * 60_000;
    return Date.parse(iso) <= ceiling ? iso : isoManila(ceiling - this.rng.int(0, 90) * 60_000);
  }

  private touch(matterId: string, iso: string): void {
    const t = Date.parse(iso);
    if (t > (this.lastActivity.get(matterId) ?? 0)) this.lastActivity.set(matterId, t);
  }

  private count(table: string, n: number): void {
    this.counts.set(table, (this.counts.get(table) ?? 0) + n);
  }

  private async insert(table: string, rows: Row[], select?: string): Promise<Row[]> {
    const out: Row[] = [];
    for (let i = 0; i < rows.length; i += 300) {
      const chunk = rows.slice(i, i + 300);
      // Rows of one table do not all name the same columns; an omitted one
      // takes its column default rather than NULL.
      const q = this.db.from(table).insert(chunk, { defaultToNull: false });
      const { data, error } = select ? await q.select(select) : await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      if (Array.isArray(data)) out.push(...(data as unknown as Row[]));
    }
    this.count(table, rows.length);
    return out;
  }

  private async update(table: string, values: Row, column: string, value: unknown): Promise<void> {
    const { error } = await this.db.from(table).update(values).eq(column, value);
    if (error) throw new Error(`${table} (update): ${error.message}`);
  }

  private async upload(bucket: string, path: string, body: Buffer, contentType: string): Promise<string> {
    const key = firmStoragePath(this.firmId, path);
    const { error } = await this.db.storage.from(bucket).upload(key, body, { contentType, upsert: true });
    if (error) throw new Error(`storage ${bucket}/${key}: ${error.message}`);
    this.storageObjects++;
    return key;
  }

  private person(key: string): Person {
    const p = this.people.get(key);
    if (!p) throw new Error(`dataset names unknown staff "${key}"`);
    return p;
  }

  private client(key: string): ClientRec {
    const c = this.clients.get(key);
    if (!c) throw new Error(`dataset names unknown client "${key}"`);
    return c;
  }

  private matter(key: string): MatterRec {
    const m = this.matters.find((x) => x.seed.key === key);
    if (!m) throw new Error(`dataset names unknown matter "${key}"`);
    return m;
  }

  private get finance(): Person {
    return this.person('marilou');
  }

  private get ongoing(): MatterRec[] {
    return this.matters.filter((m) => m.seed.status === MATTER_STATUS.ONGOING);
  }

  // ── 1. People ──

  private async seedTeam(adminEmail: string): Promise<void> {
    const { data: admin, error } = await this.db
      .from('team')
      .select('person_id, auth_user_id')
      .eq('email', adminEmail)
      .maybeSingle();
    if (error) throw new Error(`team (admin lookup): ${error.message}`);
    if (!admin?.person_id || !admin.auth_user_id) {
      throw new Error(`team: the provisioned admin ${adminEmail} is missing or has no login`);
    }

    const rows: Row[] = [];
    STAFF.forEach((s, i) => {
      const words = s.name.split(/\s+/).filter((w) => !/^[A-Z]\.$/.test(w));
      const email = `${words[0]}.${words.slice(1).join('')}@${STAFF_DOMAIN}`.toLowerCase();
      const isAdmin = email === adminEmail.toLowerCase();
      const personId = isAdmin ? (admin.person_id as string) : mintId('user');
      const initials = `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
      this.people.set(s.key, { seed: s, personId, name: s.name, email, position: s.position, initials });
      const details = {
        nickname: s.nickname,
        initials,
        mobile_number: `+63 900 000 ${String(101 + i).padStart(4, '0')}`,
        start_date: this.day(-s.yearsAtFirm * 365 - this.rng.int(0, 200)),
        monthly_salary: s.salary,
      };
      if (isAdmin) return;
      rows.push({
        notion_id: personId,
        person_id: personId,
        name: s.name,
        email,
        position: s.position,
        role: s.role,
        active: true,
        is_external: false,
        created_time: this.at(details.start_date, 9),
        ...details,
      });
    });
    const adminSeed = [...this.people.values()].find((p) => p.email === adminEmail.toLowerCase());
    if (!adminSeed) throw new Error(`team: firm.json's admin ${adminEmail} is not in the demo staff list`);

    await this.insert('team', rows);
    const adminIndex = STAFF.indexOf(adminSeed.seed);
    const { error: adminErr } = await this.db
      .from('team')
      .update({
        nickname: adminSeed.seed.nickname,
        initials: adminSeed.initials,
        mobile_number: `+63 900 000 ${String(101 + adminIndex).padStart(4, '0')}`,
        start_date: this.day(-adminSeed.seed.yearsAtFirm * 365),
        monthly_salary: adminSeed.seed.salary,
      })
      .eq('person_id', adminSeed.personId);
    if (adminErr) throw new Error(`team (admin details): ${adminErr.message}`);

    // Logins only for the personas; the admin already has one from provisioning.
    const auth = getSupabase().auth.admin;
    for (const p of this.people.values()) {
      const key = p.seed.persona;
      if (!key) continue;
      this.personas[key] = p.personId;
      if (p.personId === adminSeed.personId) continue;
      const { data, error: authErr } = await auth.createUser({
        email: p.email,
        email_confirm: true,
        password: crypto.randomBytes(24).toString('base64url'),
        user_metadata: { name: p.name },
      });
      if (authErr || !data.user) throw new Error(`auth user for ${p.email}: ${authErr?.message ?? 'no user returned'}`);
      const { error: linkErr } = await this.db.from('team').update({ auth_user_id: data.user.id }).eq('person_id', p.personId);
      if (linkErr) {
        await auth.deleteUser(data.user.id);
        throw new Error(`team (link login for ${p.email}): ${linkErr.message}`);
      }
      this.count('auth users', 1);
    }

    const { data: prefs } = await this.db.from('user_preferences').select('email');
    const have = new Set((prefs ?? []).map((r: Row) => String(r.email).toLowerCase()));
    await this.insert(
      'user_preferences',
      [...this.people.values()].filter((p) => !have.has(p.email)).map((p) => ({ email: p.email })),
    );
  }

  // ── 2. Firm settings ──

  private async seedFirmSettings(): Promise<void> {
    const { data: rates, error } = await this.db.from('billing_rates').select('position');
    if (error) throw new Error(`billing_rates: ${error.message}`);
    const have = new Set((rates ?? []).map((r: Row) => r.position as string));
    for (const r of HOURLY_RATES) {
      if (have.has(r.position)) {
        await this.update('billing_rates', { hourly_rate: r.hourlyRate, effective_from: this.day(-365) }, 'position', r.position);
      } else {
        await this.insert('billing_rates', [{ position: r.position, hourly_rate: r.hourlyRate, currency: 'PHP', effective_from: this.day(-365) }]);
      }
    }
    this.count('billing_rates (priced)', HOURLY_RATES.length);

    const managing = this.person('isabel');
    const { data: settings, error: fisErr } = await this.db
      .from('firm_invoice_settings')
      .update({
        firm_address: FIRM.address,
        firm_address2: FIRM.address2,
        firm_tin: FIRM.tin,
        bank_name: FIRM.bankName,
        bank_account_no: FIRM.bankAccountNo,
        bank_account_name: FIRM.bankAccountName,
        signer_name: managing.name.toUpperCase(),
        updated_by: managing.email,
      })
      .select('firm_id');
    if (fisErr) throw new Error(`firm_invoice_settings: ${fisErr.message}`);
    if (!settings?.length) throw new Error('firm_invoice_settings: provisioning left no row to complete');
    this.count('firm_invoice_settings (completed)', 1);

    const partners = STAFF.filter((s) => s.role === 'partner').map((s) => this.person(s.key));
    const ofCounsel = STAFF.filter((s) => s.position === 'Of Counsel').map((s) => this.person(s.key));
    const associates = STAFF.filter((s) => s.role === 'lawyer' && s.position !== 'Of Counsel').map((s) => this.person(s.key));
    const support = STAFF.filter((s) => !s.feeEarner).map((s) => this.person(s.key));
    const profile: FirmProfileContent = {
      cover: {
        firmName: FIRM.name,
        fullName: `${FIRM.name} Law Offices`,
        year: this.today.slice(0, 4),
        subtitle: 'Firm Profile',
        practiceTags: ['Litigation', 'Labor', 'Corporate', 'Tax', 'Intellectual Property'],
      },
      about: {
        heading: 'About Us',
        tagline: 'Practical counsel for growing Philippine businesses.',
        paragraphs: [
          `${FIRM.name} is a full-service law firm in Makati City advising companies, families and entrepreneurs on disputes, employment, corporate housekeeping, tax and intellectual property.`,
          'We staff every matter with a partner who stays on it from engagement to closing, and we report to clients in plain language, on a schedule they set.',
          'This profile belongs to a fictional firm built for the Lumilex demonstration.',
        ],
      },
      practiceAreas: {
        heading: 'Practice Areas',
        items: [
          { title: 'Litigation and Dispute Resolution', description: 'Collection suits, lease and contract disputes, ejectment, replevin and appeals.' },
          { title: 'Labor and Employment', description: 'NLRC cases, handbooks, disciplinary procedure and wage-order compliance.' },
          { title: 'Corporate and Commercial', description: 'Incorporation, SEC reportorial compliance, share transactions and commercial contracts.' },
          { title: 'Tax', description: 'Assessment protests, reinvestigation and tax-exposure reviews.' },
          { title: 'Intellectual Property', description: 'Trademark prosecution, oppositions, portfolio management and enforcement.' },
        ],
      },
      team: {
        heading: 'Our Team',
        groups: [
          { label: 'PARTNERS', layout: 'list', members: partners.map((p) => ({ name: p.name, title: p.position, bio: `${p.name.split(' ')[0]} leads the firm’s ${p.position === 'Partner' ? 'corporate and intellectual property' : 'litigation and labor'} work.` })) },
          { label: 'OF COUNSEL', layout: 'grid', members: ofCounsel.map((p) => ({ name: p.name, title: p.position })) },
          { label: 'ASSOCIATES', layout: 'grid', members: associates.map((p) => ({ name: p.name, title: p.position })) },
        ],
        supportLabel: 'Support Team',
        support: support.map((p) => ({ name: p.name, role: p.position })),
      },
      glance: {
        heading: 'The Firm at a Glance',
        stats: [
          { value: String(STAFF.filter((s) => s.feeEarner).length), label: 'lawyers' },
          { value: String(CLIENTS.length), label: 'active and prospective clients' },
          { value: String(MATTERS.length), label: 'matters handled this year' },
        ],
        affiliationsLabel: 'Affiliations',
        affiliations: [],
      },
      contact: {
        heading: 'Contact Us',
        officeLabel: 'Office',
        addressLines: [FIRM.address, FIRM.address2],
        phone: FIRM.phone,
        email: FIRM.email,
        website: STAFF_DOMAIN,
      },
    };
    const { data: existing } = await this.db.from('firm_profiles').select('id').eq('is_default', true).maybeSingle();
    if (existing?.id) {
      await this.update('firm_profiles', { content: profile, name: 'Firm Profile', updated_at: new Date().toISOString() }, 'id', existing.id);
      this.count('firm_profiles (filled)', 1);
    } else {
      await this.insert('firm_profiles', [{ name: 'Firm Profile', content: profile, is_default: true, created_by: managing.personId }]);
    }
  }

  // ── 3. Clients and matters ──

  private async seedClientsAndMatters(): Promise<void> {
    const clientRows = CLIENTS.map((c) => {
      const id = mintId('client');
      this.clients.set(c.key, { seed: c, id });
      return {
        notion_id: id,
        notion_url: '',
        name: c.name,
        full_company_name: c.full,
        client_code: c.code,
        status: 'Prospective',
        tin: `000-000-${String(c.code).padStart(3, '0')}-00000`,
        contact_email: c.individual
          ? `${c.contact.split(' ')[0].toLowerCase()}@${c.emailDomain}`
          : `legal@${c.emailDomain}`,
        phone_number: `(02) 8000 0${c.code}`,
        point_persons: `${c.contact}, ${c.contactTitle}`,
        priority: c.priority,
        discount: c.discount,
        collection_risk: c.collectionRisk,
        relationship_partner_id: this.person(c.partner).personId,
        deposit_balance: 0,
        created_time: this.at(this.day(-this.rng.int(420, 1400)), 10),
      };
    });
    await this.insert('clients', clientRows);

    const typeCodes = await fetchMatterTypeCodes(this.firmId);
    const seqByClient = new Map<string, number>();
    const matterRows: Row[] = [];
    for (const m of MATTERS) {
      const client = this.client(m.client);
      const typeCode = typeCodes[m.type];
      if (typeCode === undefined) throw new Error(`matters: the firm has no type code for "${m.type}"`);
      const seq = seqByClient.get(m.client) ?? 0;
      seqByClient.set(m.client, seq + 1);
      const rec: MatterRec = {
        seed: m,
        id: mintId('matter'),
        code: `${client.seed.code}-${typeCode}-${seq}`,
        client,
        team: m.team.map((k) => this.person(k)),
        opened: this.day(-m.openedDaysAgo),
      };
      this.matters.push(rec);
      const c = m.case;
      matterRows.push({
        notion_id: rec.id,
        notion_url: '',
        name: m.name,
        client_id: client.id,
        client_name: client.seed.name,
        matter_code: rec.code,
        type: m.type,
        status: m.status,
        court: c?.court ?? '',
        case_number: c?.docket ?? '',
        case_title: c ? (c.clientFiled ? `${client.seed.full} v. ${c.adverse}` : `${c.adverse} v. ${client.seed.full}`) : '',
        case_description: c?.description ?? '',
        team_person_ids: rec.team.map((p) => p.personId),
        related_matter_ids: [],
        date: rec.opened,
        created_time: this.at(rec.opened, 10),
        remarks: '',
        outcome:
          m.status === MATTER_STATUS.DONE
            ? 'Completed; final work product delivered and the file closed.'
            : m.status === MATTER_STATUS.ARCHIVED
              ? 'Settled by compromise; the tenants vacated and the case was dismissed.'
              : '',
        parent_matter_name: '',
      });
    }
    await this.insert('matters', matterRows);

    const configs: Row[] = [];
    this.matters.forEach((m, i) => {
      if (m.seed.billing === 'none') return;
      const base = { matter_id: m.id, billing_type: m.seed.billing, engagement_date: m.opened, notes: '' };
      if (m.seed.billing === 'litigation') {
        configs.push({ ...base, acceptance_fee: 50000 + (i % 4) * 25000, acceptance_fee_paid: m.seed.openedDaysAgo > 60 });
      } else if (m.seed.billing === 'retainer') {
        configs.push({ ...base, monthly_retainer: 80000 + (i % 3) * 20000, retainer_hours_cap: 20 });
      } else {
        configs.push({ ...base, fixed_fee_amount: 150000 + (i % 4) * 50000 });
      }
    });
    await this.insert('matter_billing_configs', configs);

    const notes = [
      ['High', 'Client wants weekly updates — keep the status report cadence tight.'],
      ['Medium', 'Watch the receivables here; the last two invoices ran late.'],
      ['High', 'Sensitive counterparty. Route all correspondence through me first.'],
      ['Low', 'Good candidate for an expanded retainer conversation in Q4.'],
      ['Medium', 'Pre-trial is the pressure point. Settlement authority is up to 70% of the claim.'],
      ['Low', 'Routine. Associate can run it; flag only if the agency raises a new requirement.'],
    ];
    await this.insert(
      'partner_matter_annotations',
      this.ongoing.slice(0, 12).map((m, i) => ({
        matter_id: m.id,
        partner_id: m.team[0].personId,
        urgency: notes[i % notes.length][0],
        notes: notes[i % notes.length][1],
      })),
    );

    const parties: Row[] = [];
    for (const m of this.matters) {
      const c = m.seed.case;
      if (!c) continue;
      parties.push({
        matter_id: m.id,
        party_name: m.client.seed.full,
        party_role: 'client',
        entity_type: m.client.seed.individual ? 'individual' : 'organization',
        source: 'manual',
      });
      const organization = /Inc\.|Corp|Co\.|Trading|Group|Occupants/.test(c.adverse);
      parties.push({
        matter_id: m.id,
        party_name: c.adverse,
        party_role: 'opposing_party',
        entity_type: organization ? 'organization' : 'individual',
        source: 'manual',
      });
    }
    await this.insert('parties', parties);
  }

  // ── 4. Deliverables, versions, actions, comments ──

  private planStatus(work: WorkSeed, gi: number): DeliverableStatus {
    const internal = work.type === DTYPE.INTERNAL;
    if (work.affidavitFixture) return S.UNDER_REVIEW;
    switch (work.stage) {
      case 'done':
        return internal ? S.ACKNOWLEDGED : S.FILED_OR_SENT_OUT;
      case 'archived':
        return S.ARCHIVED;
      case 'early':
        return internal || gi % 2 === 0 ? S.NOT_STARTED : S.DRAFTING;
      default: {
        const external = [S.UNDER_REVIEW, S.DRAFTING, S.REVISING, S.FINALIZING, S.UNDER_REVIEW, S.PRE_FINALIZED, S.OUTBOX, S.AWAITING_CLIENT, S.REVISING, S.DRAFTING];
        return internal ? (gi % 2 === 0 ? S.DRAFTING : S.SUBMITTED) : external[gi % external.length];
      }
    }
  }

  /** The workflow actions that take a new deliverable to `target`, in order. */
  private pathTo(target: DeliverableStatus, internal: boolean, revisions: number): Step[] {
    const start: Step = { label: 'Start Drafting', from: S.NOT_STARTED, to: S.DRAFTING, by: 'drafter' };
    if (target === S.NOT_STARTED) return [];
    if (internal) {
      const steps: Step[] = [start];
      if (target === S.DRAFTING) return steps;
      steps.push({ label: 'Submit', from: S.DRAFTING, to: S.SUBMITTED, by: 'drafter', comment: 'Submitted for your reference.', version: { kind: 'docx', action: 'Submitted for acknowledgment' } });
      if (target === S.SUBMITTED) return steps;
      steps.push({ label: 'Acknowledge', from: S.SUBMITTED, to: S.ACKNOWLEDGED, by: 'reviewer' });
      return steps;
    }
    if (target === S.DRAFTING) return [start];
    if (target === S.ARCHIVED) {
      return [start, { label: 'Archive', from: S.DRAFTING, to: S.ARCHIVED, by: 'reviewer', comment: 'Overtaken by the compromise agreement; no longer needed.' }];
    }
    const steps: Step[] = [start, { label: 'For Review', from: S.DRAFTING, to: S.UNDER_REVIEW, by: 'drafter', comment: 'Draft attached for your review.', version: { kind: 'docx', action: 'For Review' } }];
    for (let r = 0; r < revisions; r++) {
      steps.push({ label: 'For Revision', from: S.UNDER_REVIEW, to: S.REVISING, by: 'reviewer', comment: this.rng.pick(REVISION_NOTES) });
      if (target === S.REVISING && r === revisions - 1) return steps;
      steps.push({ label: 'For Review', from: S.REVISING, to: S.UNDER_REVIEW, by: 'drafter', comment: 'Revised per your comments.', version: { kind: 'docx', action: 'Revised draft' } });
    }
    if (target === S.UNDER_REVIEW) return steps;
    if (target === S.AWAITING_CLIENT) {
      steps.push({ label: S.AWAITING_CLIENT, from: S.UNDER_REVIEW, to: S.AWAITING_CLIENT, by: 'drafter', comment: 'Sent to the client for comment; waiting on their inputs.' });
      return steps;
    }
    steps.push({ label: 'For Finalization', from: S.UNDER_REVIEW, to: S.FINALIZING, by: 'reviewer', comment: 'Approved. Please finalize.' });
    if (target === S.FINALIZING) return steps;
    steps.push({ label: 'Mark as Pre-finalized', from: S.FINALIZING, to: S.PRE_FINALIZED, by: 'drafter' });
    if (target === S.PRE_FINALIZED) return steps;
    steps.push({ label: 'Mark as Finalized', from: S.PRE_FINALIZED, to: S.OUTBOX, by: 'reviewer', version: { kind: 'pdf', action: 'Finalized' } });
    if (target === S.OUTBOX) return steps;
    steps.push({ label: 'Mark as Filed/Sent Out', from: S.OUTBOX, to: S.FILED_OR_SENT_OUT, by: 'drafter', comment: 'Filed; the stamped copy is attached.', version: { kind: 'pdf', action: FILED_VERSION_ACTION, filedCopy: true } });
    return steps;
  }

  private planDeliverables(): void {
    let gi = 0;
    for (const m of this.matters) {
      m.seed.work.forEach((work, wi) => {
        const internal = work.type === DTYPE.INTERNAL;
        const status = this.planStatus(work, gi);
        if (!statusesForType(work.type).includes(status)) {
          throw new Error(`deliverables: "${status}" is not a status a ${work.type} deliverable can hold`);
        }
        const [partner, senior, junior] = m.team;
        const drafter = work.affidavitFixture || !junior ? senior ?? partner : wi % 2 === 0 ? senior : junior;
        const reviewers = drafter === junior && senior ? [senior, partner] : [partner];
        const needsRevision = status === S.REVISING;
        const reviewed = ([S.UNDER_REVIEW, S.REVISING, S.FINALIZING, S.PRE_FINALIZED, S.OUTBOX, S.FILED_OR_SENT_OUT, S.AWAITING_CLIENT] as DeliverableStatus[]).includes(status);
        const revisions = work.affidavitFixture || !reviewed || internal ? 0 : needsRevision ? this.rng.int(1, 2) : this.rng.int(0, 2);
        const steps = this.pathTo(status, internal, revisions);

        // Timeline, in days relative to today.
        const openedAgo = m.seed.openedDaysAgo;
        let createdOff: number;
        let lastOff: number;
        if (m.seed.status === MATTER_STATUS.ARCHIVED) {
          lastOff = -openedAgo + 60 + wi * 40;
          createdOff = lastOff - this.rng.int(10, 25);
        } else if (work.stage === 'done' || m.seed.status === MATTER_STATUS.DONE) {
          const lo = Math.max(-openedAgo + 20, -150);
          lastOff = m.seed.status === MATTER_STATUS.DONE ? this.rng.int(lo, -35) : this.rng.int(lo, -3);
          createdOff = Math.max(-openedAgo + 2, lastOff - this.rng.int(10, 30));
        } else if (work.stage === 'early') {
          createdOff = -this.rng.int(this.recent, 6);
          lastOff = createdOff;
        } else {
          lastOff = -this.rng.int(this.recent, 7);
          createdOff = Math.max(-openedAgo + 2, lastOff - this.rng.int(8, 35));
        }
        const createdDay = this.day(createdOff);
        const created = this.past(createdDay, 9, this.rng.int(0, 59));
        const startMs = Date.parse(created) + 3600_000;
        const endMs = Math.max(Date.parse(this.past(this.day(lastOff), 17, this.rng.int(0, 45))), startMs + steps.length * 3600_000);
        const timed = steps.map((step, i) => ({
          step,
          at: isoManila(Math.min(startMs + ((endMs - startMs) * (i + 1)) / (steps.length + 1), Date.now() - 15 * 60_000)),
        }));

        let due: string | null;
        let dateDone: string | null = null;
        if (status === S.FILED_OR_SENT_OUT || status === S.ACKNOWLEDGED) {
          dateDone = timed.length ? timed[timed.length - 1].at.slice(0, 10) : this.day(lastOff);
          due = dateDone;
        } else if (status === S.ARCHIVED) {
          due = this.day(lastOff);
        } else if (work.stage === 'early') {
          due = this.weekday(this.day(this.rng.int(14, 45)));
        } else if (gi % 7 === 3) {
          due = this.weekday(this.day(-this.rng.int(1, 4)), -1);
        } else if (gi % 17 === 5) {
          // A few due today: the golden snapshot is shifted to every later
          // day, so whatever is due on the build day is what "due today"
          // shows for as long as the snapshot stands.
          due = this.weekday(this.today);
        } else {
          due = this.weekday(this.day(this.rng.int(1, 35)));
        }
        if (work.type === DTYPE.INTERNAL && work.stage !== 'done' && gi % 3 === 0) due = null;

        this.deliverables.push({
          id: mintId('deliverable'),
          work,
          matter: m,
          status,
          drafters: [drafter],
          reviewers,
          created,
          due,
          dateDone,
          revisions,
          steps: timed,
        });
        gi++;
      });
    }
  }

  private currentlyWith(d: DeliverableRec): string[] {
    const ids = (ps: Person[]) => ps.map((p) => p.personId);
    switch (d.status) {
      case S.NOT_STARTED:
      case S.DRAFTING:
      case S.REVISING:
      case S.AWAITING_CLIENT:
        return ids(d.drafters);
      case S.UNDER_REVIEW:
        return ids([d.reviewers[(d.revisions + (d.reviewers.length > 1 ? 1 : 0)) % d.reviewers.length]]);
      case S.FINALIZING:
      case S.PRE_FINALIZED:
      case S.OUTBOX:
      case S.FILED_OR_SENT_OUT:
        return [...new Set(ids([...d.drafters, ...d.reviewers]))];
      case S.SUBMITTED:
        return ids(d.reviewers);
      default:
        return [];
    }
  }

  private docContext(d: DeliverableRec, date: string, index: number) {
    const nextHearing = this.hearings
      .filter((h) => h.matter === d.matter && h.day > this.today && h.status === HEARING_SCHEDULED)
      .sort((a, b) => a.day.localeCompare(b.day))[0];
    return {
      work: d.work,
      matter: d.matter.seed,
      client: d.matter.client.seed,
      drafter: { name: d.drafters[0].name, position: d.drafters[0].position },
      signer: { name: d.matter.team[0].name, position: d.matter.team[0].position },
      reviewer: { name: d.reviewers[d.reviewers.length - 1].name, position: d.reviewers[d.reviewers.length - 1].position },
      date,
      index,
      nextEvent: nextHearing
        ? `The next setting is on ${longDate(nextHearing.day)}. We will prepare for it and report on the outcome the same day.`
        : undefined,
    };
  }

  private async seedDeliverables(): Promise<void> {
    this.planDeliverables();

    // Version files first: a version row inserted before its deliverable
    // exists never matches the finalized-status webhook.
    const versionRows: Row[] = [];
    const jobs: { d: DeliverableRec; version: number; kind: 'docx' | 'pdf'; action: string; at: string; by: Person; filedCopy?: true }[] = [];
    this.deliverables.forEach((d, di) => {
      if (d.work.affidavitFixture) return;
      let version = 0;
      d.steps.forEach(({ step, at }) => {
        if (!step.version) return;
        version++;
        const by = step.by === 'drafter' ? d.drafters[0] : d.reviewers[d.reviewers.length - 1];
        jobs.push({ d, version, kind: step.version.kind, action: step.version.action, at, by, filedCopy: step.version.filedCopy });
      });
      if (version === 0 && d.status === S.DRAFTING && di % 2 === 0 && d.steps.length) {
        jobs.push({ d, version: 1, kind: 'docx', action: 'Working draft', at: d.steps[0].at, by: d.drafters[0] });
      }
    });

    // A filed copy stamps the finalized PDF, so every finalized PDF is rendered first.
    const finalized = new Map<string, Buffer>();
    const record = async (job: (typeof jobs)[number], i: number) => {
      const { d, version, kind, at, by } = job;
      let { action } = job;
      let body: Buffer;
      let fileName = `${d.matter.code}_${slug(d.work.title)}${kind === 'pdf' ? '' : `_v${version}`}.${kind}`;
      if (job.filedCopy) {
        const filedWithAuthority = wasFiledWithAuthority(d.work.type);
        body = await stampFiledCopy(finalized.get(d.id)!, { filedWithAuthority, day: d.dateDone ?? at.slice(0, 10) });
        action = `${action} — ${filedWithAuthority ? 'received copy' : 'sent copy'}`;
        fileName = fileName.replace(/\.pdf$/, filedWithAuthority ? '_received.pdf' : '_sent.pdf');
      } else {
        const spec = composeDocument(this.docContext(d, at.slice(0, 10), i));
        body = kind === 'pdf' ? await renderPdf(spec) : await renderDocx(spec, `v${version} · ${action}`);
        if (kind === 'pdf') finalized.set(d.id, body);
      }
      const key = await this.upload('files', `${d.id}/v${version}/${sanitizeName(fileName)}`, body, kind === 'pdf' ? PDF_TYPE : DOCX_TYPE);
      versionRows.push({
        deliverable_id: d.id,
        version,
        file_name: fileName,
        file_url: key,
        file_size: body.length,
        uploaded_by: by.personId,
        action,
        needs_reupload: false,
        created_at: isoManila(Date.parse(at) - 7 * 60_000),
      });
    };
    const indexed = jobs.map((job, i) => ({ job, i }));
    await pool(indexed.filter(({ job }) => !job.filedCopy), 6, ({ job, i }) => record(job, i));
    await pool(indexed.filter(({ job }) => job.filedCopy), 6, ({ job, i }) => record(job, i));

    const fixture = this.deliverables.find((d) => d.work.affidavitFixture);
    if (fixture) {
      const c = fixture.matter.seed.case!;
      const parties = {
        court: c.court,
        plaintiff: fixture.matter.client.seed.full,
        defendant: c.adverse,
        docket: c.docket,
        nature: c.nature,
        counsel: fixture.drafters[0].name.toUpperCase(),
      };
      const reviewStep = fixture.steps.find((s) => s.step.label === 'For Review') ?? fixture.steps[0];
      for (const [body, name, type] of [
        [await renderFixturePdf(parties), 'Judicial_Affidavit_Bernardo.pdf', PDF_TYPE],
        [await renderFixtureDocx(parties), 'Judicial_Affidavit_Bernardo.docx', DOCX_TYPE],
      ] as [Buffer, string, string][]) {
        const key = await this.upload('files', `${fixture.id}/v1/${name}`, body, type);
        versionRows.push({
          deliverable_id: fixture.id,
          version: 1,
          file_name: name,
          file_url: key,
          file_size: body.length,
          uploaded_by: fixture.drafters[0].personId,
          action: 'For Review',
          needs_reupload: false,
          created_at: isoManila(Date.parse(reviewStep.at) - 7 * 60_000),
        });
      }
    }
    await this.insert('deliverable_files', versionRows);

    await this.insert(
      'deliverables',
      this.deliverables.map((d) => ({
        notion_id: d.id,
        notion_url: '',
        name: d.work.title,
        matter_id: null,
        matter_name: d.matter.seed.name,
        client_name: d.matter.client.seed.name,
        status: d.status,
        type: d.work.type,
        subtype: d.work.subtype,
        priority: d.due && d.due <= this.day(7) && d.dateDone === null ? 'High' : this.rng.pick(['Medium', 'Medium', 'Low', 'High']),
        drafter_ids: [],
        reviewer_ids: d.reviewers.map((p) => p.personId),
        review_dates: [],
        currently_with_ids: this.currentlyWith(d),
        external_due_date: d.due,
        date_done: d.dateDone,
        revision_count: d.revisions,
        created_time: d.created,
      })),
    );
    await pool(this.deliverables, 8, async (d) => {
      await this.update('deliverables', { matter_id: d.matter.id, drafter_ids: d.drafters.map((p) => p.personId) }, 'notion_id', d.id);
    });

    const actions: Row[] = [];
    const comments: Row[] = [];
    this.deliverables.forEach((d, i) => {
      for (const { step, at } of d.steps) {
        const by = step.by === 'drafter' ? d.drafters[0] : d.reviewers[d.reviewers.length - 1];
        actions.push({
          deliverable_id: d.id,
          action: step.label,
          old_status: step.from,
          new_status: step.to,
          performed_by: by.personId,
          comment: step.comment ?? null,
          mentions: [],
          created_at: at,
        });
        this.touch(d.matter.id, at);
      }
      if (d.steps.length >= 2 && i % 3 === 0) {
        const first = Date.parse(d.steps[0].at);
        const last = Date.parse(d.steps[d.steps.length - 1].at);
        comments.push({
          deliverable_id: d.id,
          person_id: (i % 2 === 0 ? d.reviewers[0] : d.drafters[0]).personId,
          comment: COMMENTS[i % COMMENTS.length],
          mentions: [],
          created_at: isoManila(first + (last - first) / 2),
        });
      }
    });
    await this.insert('deliverable_actions', actions);
    await this.insert('deliverable_comments', comments);
  }

  // ── 5. Hearings, meetings, tasks ──

  private planHearings(): void {
    const forward: Record<string, number[]> = {
      collection: [0, 2, 30],
      ramirez: [6],
      lease: [13],
      opposition: [23],
      marikit: [9],
      delapaz: [1, 27],
      ejectment: [16],
      replevin: [8, 41],
    };
    for (const m of this.matters) {
      const c = m.seed.case;
      if (!c) continue;
      const labels =
        c.forum === 'labor'
          ? [['Initial Hearing', 'Mandatory Conference'], ['Initial Hearing', 'Mandatory Conference (second setting)'], ['Motion Hearing', 'Clarificatory Hearing']]
          : c.forum === 'ipophl'
            ? [['Pre-Trial', 'Preliminary Conference'], ['Pre-Trial', 'Preliminary Conference (continuation)']]
            : [['Motion Hearing', 'Hearing on Pending Motion'], ['Pre-Trial', 'Pre-Trial Conference'], ['Trial', 'Trial — Presentation of Plaintiff’s Evidence']];
      const [partner, associate] = m.team;
      const attendees = associate ? [associate, partner] : [partner];
      const pastCount = m.seed.status === MATTER_STATUS.ARCHIVED ? 2 : Math.min(3, Math.max(1, Math.floor(m.seed.openedDaysAgo / 60)));
      for (let i = 0; i < pastCount; i++) {
        const span = Math.min(m.seed.openedDaysAgo - 20, m.seed.status === MATTER_STATUS.ARCHIVED ? 400 : 120);
        const off = m.seed.status === MATTER_STATUS.ARCHIVED ? -m.seed.openedDaysAgo + 30 + i * 45 : -Math.round(span * (pastCount - i) / (pastCount + 0.5)) - 2;
        const day = this.weekday(this.day(off), -1);
        const label = labels[Math.min(i, labels.length - 1)][1];
        const status = i === 0 && pastCount > 2 ? HEARING_POSTPONED : HEARING_ATTENDED;
        this.hearings.push({ id: mintId('hearing'), matter: m, name: `${label} — ${m.seed.name}`, day, at: this.at(day, this.rng.pick([8, 9, 10, 13, 14]), this.rng.pick([0, 30])), status, attendees: status === HEARING_ATTENDED ? attendees : attendees.slice(0, 1) });
      }
      for (const [j, off] of (forward[m.seed.key] ?? []).entries()) {
        const day = this.weekday(this.day(off));
        const label = labels[Math.min(pastCount + j, labels.length - 1)][1];
        this.hearings.push({ id: mintId('hearing'), matter: m, name: `${label} — ${m.seed.name}`, day, at: this.at(day, j === 0 ? 9 : 13, j === 0 ? 0 : 30), status: HEARING_SCHEDULED, attendees });
      }
    }
    // One cancelled setting, as happens when a court is declared a non-working day.
    const cancel = this.hearings.find((h) => h.status === HEARING_ATTENDED && h.matter.seed.key === 'lease');
    if (cancel) cancel.status = HEARING_CANCELLED;
  }

  private hearingType(h: HearingRec): string {
    const n = h.name;
    if (/Mandatory Conference/.test(n)) return 'Initial Hearing';
    if (/Preliminary Conference|Pre-Trial/.test(n)) return 'Pre-Trial';
    if (/Trial/.test(n)) return 'Trial';
    return 'Motion Hearing';
  }

  private async seedCalendar(): Promise<void> {
    await this.insert(
      'hearings',
      this.hearings.map((h) => ({
        notion_id: h.id,
        notion_url: '',
        name: h.name,
        matter_id: null,
        matter_name: h.matter.seed.name,
        date: h.at,
        type: this.hearingType(h),
        status: h.status,
        attendee_ids: h.attendees.map((p) => p.personId),
        is_attended: h.status === HEARING_ATTENDED,
        is_filed: false,
        created_time: this.past(this.day(Math.min(-1, Math.round((Date.parse(h.at) - Date.now()) / 86400_000) - 21)), 11),
      })),
    );
    await pool(this.hearings, 8, async (h) => {
      await this.update('hearings', { matter_id: h.matter.id }, 'notion_id', h.id);
      if (h.day <= this.today) this.touch(h.matter.id, h.at);
    });

    // Meetings — client conferences, internal strategy sessions, one site visit.
    const meetingTypes = ['Client Meeting', 'Internal Discussion', 'Conference', 'Client Meeting', 'Mediation'];
    const locations = ['Firm conference room', 'Client office, Bonifacio Global City', 'Video call', 'Firm conference room', 'Philippine Mediation Center, Makati'];
    const meetings: Row[] = [];
    const active = this.ongoing;
    for (let i = 0; i < 28; i++) {
      const m = active[(i * 5) % active.length];
      const future = i >= 18;
      // The first upcoming meeting is this afternoon, so today is never empty.
      const off = future ? (i === 18 ? 0 : this.rng.int(1, 21)) : -this.rng.int(1, 90);
      const day = this.weekday(this.day(off), future ? 1 : -1);
      const kind = meetingTypes[i % meetingTypes.length];
      const type = kind === 'Mediation' && !m.seed.case ? 'Client Meeting' : kind;
      const hour = i === 18 ? 15 : [9, 10, 11, 14, 15, 16][i % 6];
      const duration = [1, 1.5, 2][i % 3];
      const start = this.at(day, hour);
      const end = this.at(day, hour + Math.floor(duration), duration % 1 ? 30 : 0);
      meetings.push({
        notion_id: mintId('meeting'),
        notion_url: '',
        name: `${type} — ${type === 'Internal Discussion' ? m.seed.name : m.client.seed.name}`,
        matter_id: m.id,
        matter_name: m.seed.name,
        type,
        date_start: start,
        date_end: end,
        duration,
        location: type === 'Internal Discussion' ? 'Firm conference room' : type === 'Mediation' ? locations[4] : locations[i % 4],
        // This afternoon's meeting has the partner and associate personas in
        // it, so their own "today" is not empty on the first click.
        attendee_ids: (i === 18
          ? [...new Set([...m.team, this.person('isabel'), this.person('diego')])]
          : m.team
        ).map((p) => p.personId),
        is_attended: !future,
        created_time: this.past(this.day(Math.min(off - 7, 0)), 10),
      });
      if (!future) this.touch(m.id, start);
    }
    // A firm-wide meeting with no matter, for the office manager's calendar.
    const monday = this.weekday(this.day(((8 - manilaDayOfWeek(this.today)) % 7) || 7));
    meetings.push({
      notion_id: mintId('meeting'),
      notion_url: '',
      name: 'Monday Docket Review',
      matter_id: null,
      matter_name: '',
      type: 'Internal Discussion',
      date_start: this.at(monday, 8, 30),
      date_end: this.at(monday, 9, 30),
      duration: 1,
      location: 'Firm conference room',
      attendee_ids: [...this.people.values()].filter((p) => p.seed.role !== 'liaison_officer').map((p) => p.personId),
      is_attended: false,
      created_time: this.past(this.day(-2), 16),
    });
    await this.insert('meetings', meetings);

    const taskNames = [
      'Secure certified true copy of the title',
      'Follow up with client on signed verification',
      'Calendar the next hearing date',
      'Prepare exhibits for marking',
      'Request SEC certified copies of the GIS',
      'Coordinate with process server',
      'Review counterparty comments on the draft',
      'Compile annexes for filing',
      'File compliance with the court',
      'Book conference room for client meeting',
      'Update the matter status report',
      'Confirm availability of witness',
    ];
    const tasks: Row[] = [];
    for (let i = 0; i < 48; i++) {
      const m = active[(i * 7) % active.length];
      const assignee =
        i === 1 ? this.person('diego')
        : i === 2 ? this.person('isabel')
        : m.team[1 + (i % Math.max(1, m.team.length - 1))] ?? m.team[0];
      const done = i % 3 === 0;
      const status = done ? TASK_STATUS.DONE : i % 3 === 1 ? TASK_STATUS.IN_PROGRESS : TASK_STATUS.NOT_STARTED;
      const created = -this.rng.int(3, 60);
      tasks.push({
        notion_id: mintId('task'),
        notion_url: '',
        name: taskNames[i % taskNames.length],
        matter_id: m.id,
        matter_name: m.seed.name,
        assignee_ids: [assignee.personId],
        due_date: done
          ? this.day(-this.rng.int(1, 30))
          : i < 6
            ? this.weekday(this.today)
            : this.weekday(this.day(this.rng.int(-3, 25))),
        status,
        done,
        priority: ['High', 'Medium', 'Low'][i % 3],
        notes: '',
        created_time: this.past(this.day(created), 10),
      });
    }
    await this.insert('tasks', tasks);
  }

  // ── 6. Leave and time ──

  private async seedLeaves(): Promise<void> {
    const partner = this.person('isabel');
    const plan: [string, string, number, number, 'Approved' | 'Pending' | 'Rejected', string][] = [
      ['paolo', 'Vacation Leave', 9, 2, 'Pending', 'Family trip to Bohol; hearings covered by Diego.'],
      ['katrina', 'Vacation Leave', 20, 3, 'Pending', 'Sister’s wedding in Iloilo.'],
      ['bianca', 'Sick Leave', -12, 1, 'Approved', 'Fever; medical certificate attached.'],
      ['diego', 'Vacation Leave', -34, 2, 'Approved', 'Long weekend with family.'],
      ['sofia', 'Personal Leave', -20, 1, 'Approved', 'Bar review orientation.'],
      ['ferdinand', 'Vacation Leave', -48, 3, 'Approved', 'Out of the country.'],
      ['marilou', 'Sick Leave', -6, 1, 'Approved', 'Clinic appointment.'],
      ['pascual', 'Emergency Leave', -27, 1, 'Approved', 'Family emergency in the province.'],
      ['paolo', 'Vacation Leave', -60, 1, 'Rejected', 'Conflicts with the trial setting; please refile for another date.'],
      ['rico', 'Vacation Leave', -75, 2, 'Approved', 'Town fiesta.'],
      ['aurora', 'Vacation Leave', 34, 5, 'Pending', 'Annual leave.'],
      ['grace', 'Sick Leave', -40, 1, 'Approved', 'Flu.'],
    ];
    const rows = plan.map(([key, leaveType, startOff, days, status, reason]) => {
      const p = this.person(key);
      const start = this.weekday(this.day(startOff), startOff < 0 ? -1 : 1);
      const end = this.weekday(addDays(start, days - 1));
      if (status === 'Approved') {
        const set = this.approvedLeave.get(p.personId) ?? new Set<string>();
        for (let d = start; d <= end; d = addDays(d, 1)) set.add(d);
        this.approvedLeave.set(p.personId, set);
      }
      const filed = addDays(start, -this.rng.int(3, 14));
      return {
        notion_id: mintId('leave'),
        notion_url: '',
        reason,
        person_id: p.personId,
        name: p.name,
        leave_type: leaveType,
        period_start: start,
        period_end: end === start ? null : end,
        status,
        approved: status === 'Approved',
        acting_partner_ids: [],
        created_by_name: p.name,
        created_time: this.past(filed, 9),
        decided_by: status === 'Pending' ? null : partner.personId,
        decided_at: status === 'Pending' ? null : this.past(addDays(filed, 1), 11),
      };
    });
    await this.insert('leaves', rows);
  }

  /** The first day of the month containing the day eight weeks ago. */
  private dtrWindowStart(): string {
    return `${this.day(-56).slice(0, 7)}-01`;
  }

  private planDtr(): void {
    const start = this.dtrWindowStart();
    const T = (t: TaskName) => t;
    const worksOf = (m: MatterRec) => this.deliverables.filter((d) => d.matter === m);
    for (let day = start; day <= this.lastLoggedDay; day = addDays(day, 1)) {
      const dow = manilaDayOfWeek(day);
      if (dow === 0 || dow === 6) continue;
      for (const p of this.people.values()) {
        if (!p.seed.feeEarner) continue;
        if (this.approvedLeave.get(p.personId)?.has(day)) continue;
        if (this.rng.chance(0.07)) continue;
        const mine = this.ongoing.filter((m) => m.team.includes(p));
        if (!mine.length) continue;
        const partnerLike = p.seed.role === 'partner';
        const entries = partnerLike ? this.rng.int(1, 2) : this.rng.int(2, 4);
        for (let e = 0; e < entries; e++) {
          const m = this.rng.pick(mine);
          const docs = worksOf(m);
          const doc = docs.length ? this.rng.pick(docs).work.title : m.seed.name;
          let task: TaskName;
          let remarks: string;
          const roll = this.rng.int(0, 9);
          if (roll === 0 && !partnerLike) {
            task = T('Draft');
            remarks = `Status Report — ${m.seed.name}`;
          } else if (partnerLike) {
            task = this.rng.pick([T('Review and Revise'), T('Correspondence'), T('Meeting'), T('Internal Discussion')]);
            remarks =
              task === 'Review and Revise' ? `Reviewed and revised ${doc}` :
              task === 'Correspondence' ? `Correspondence with ${m.client.seed.contact} re: ${m.seed.name}` :
              task === 'Meeting' ? `Conference with client re: ${m.seed.name}` :
              `Strategy discussion with the team on ${m.seed.name}`;
          } else {
            task = this.rng.pick([T('Draft'), T('Draft'), T('Research'), T('Study'), T('Correspondence'), T('Finalize'), T('Review and Revise')]);
            remarks =
              task === 'Draft' ? `Drafted ${doc}` :
              task === 'Research' ? `Legal research for ${doc}` :
              task === 'Study' ? `Study of case records and client documents — ${m.seed.name}` :
              task === 'Correspondence' ? `Emails with ${m.client.seed.contact} on outstanding requirements` :
              task === 'Finalize' ? `Finalized ${doc} for signature` :
              `Revised ${doc} per partner’s comments`;
          }
          const minutes = partnerLike ? this.rng.pick([30, 45, 60, 90, 120]) : this.rng.pick([45, 60, 90, 120, 150, 180]);
          this.pushDtr(p, m, day, task, remarks, minutes, [], this.at(day, 18, this.rng.int(0, 45)));
        }
      }
    }
    // Hearing attendance, logged once by the associate with the partner as "With".
    for (const h of this.hearings) {
      if (h.status !== HEARING_ATTENDED || h.day < start || h.day > this.lastLoggedDay) continue;
      const [lead, ...others] = h.attendees;
      this.pushDtr(lead, h.matter, h.day, 'Hearing', `Attended ${h.name.split(' — ')[0].toLowerCase()} at the ${h.matter.seed.case?.court ?? 'court'}`, this.rng.pick([120, 150, 180]), others, this.at(h.day, 17));
    }
  }

  private pushDtr(p: Person, m: MatterRec, day: string, task: TaskName, remarks: string, minutes: number, withPeople: Person[], created: string): void {
    this.dtr.push({
      person: p,
      matter: m,
      day,
      minutes,
      billable: !/^Status Report/i.test(remarks),
      row: {
        notion_id: mintId('dtr'),
        notion_url: '',
        remarks,
        task,
        hours: Math.floor(minutes / 60),
        minutes: minutes % 60,
        date: day,
        lawyer_name: p.name,
        with_ids: withPeople.map((w) => w.personId),
        with_names: withPeople.map((w) => w.name),
        client_name: m.client.seed.name,
        matter_id: m.id,
        billed: false,
        created_time: this.clampPast(created),
      },
    });
    this.touch(m.id, this.clampPast(created));
  }

  // ── 7. Expenses, invoices, collections ──

  private async seedMoney(): Promise<void> {
    const currentMonth = this.today.slice(0, 7);
    const windowStart = this.dtrWindowStart();
    const monthsBefore = (month: string, n: number) => addMonths(`${month}-01`, -n).slice(0, 7);
    const billedMonths: string[] = [];
    for (let mo = windowStart.slice(0, 7); mo < currentMonth; mo = monthsBefore(mo, -1)) billedMonths.push(mo);
    const olderMonths = [3, 2, 1].map((n) => monthsBefore(windowStart.slice(0, 7), n));
    const lastBilled = billedMonths[billedMonths.length - 1];
    const draftClient = 'bakal';

    // Expenses paid on matters and reimbursed to staff, inside the time window.
    const expenseMatters = this.ongoing;
    const matterExpenses = Array.from({ length: 46 }, (_, i) => {
      const m = expenseMatters[(i * 4) % expenseMatters.length];
      const [description, category, amount] = this.rng.pick([
        ['Filing fees — Office of the Clerk of Court', 'Filing Fees', 4800],
        ['Sheriff’s fees for service of summons', 'Court Fees', 2500],
        ['Notarial fees for verification and affidavits', 'Notarial', 1200],
        ['Certified true copies of SEC documents', 'Filing Fees', 850],
        ['Courier to opposing counsel', 'Postage', 350],
        ['Photocopying and binding of exhibits', 'Printing', 1650],
        ['Transportation to hearing', 'Transportation', 500],
        ['IPOPHL filing and publication fees', 'Filing Fees', 8500],
      ] as [string, string, number][]);
      const day = this.day(-this.rng.int(this.recent, Math.max(1, Math.round((Date.parse(this.today) - Date.parse(windowStart)) / 86400_000))));
      return { m, day, row: { matter_id: m.id, description, amount, category, expense_date: day, created_by: m.team[1]?.personId ?? m.team[0].personId, billed: false } as Row };
    });
    const liaisons = [this.person('rico'), this.person('pascual')];
    const reimbursements = Array.from({ length: 18 }, (_, i) => {
      const m = expenseMatters[(i * 6) % expenseMatters.length];
      const p = i % 3 === 2 ? m.team[m.team.length - 1] : liaisons[i % 2];
      const [expense, category, amount] = this.rng.pick([
        ['Taxi to the Regional Trial Court for filing', 'Transportation', 320],
        ['Meals during overtime for filing deadline', 'Meals', 450],
        ['Parking at City Hall', 'Transportation', 180],
        ['Courier charges for client documents', 'Postage', 250],
        ['Photocopies at the court', 'Printing', 120],
        ['Documentary stamps for affidavits', 'Filing Fees', 600],
      ] as [string, string, number][]);
      const day = this.day(-this.rng.int(this.recent, Math.max(1, Math.round((Date.parse(this.today) - Date.parse(windowStart)) / 86400_000))));
      return { m, day, p, id: mintId('reimb'), expense, category, amount };
    });

    // Plan invoices: one per client per billed month from the time actually
    // logged, plus three earlier months summarised without entry detail.
    const rateOf = new Map(HOURLY_RATES.map((r) => [r.position, r.hourlyRate]));
    interface Plan {
      client: ClientRec;
      month: string;
      status: 'draft' | 'sent' | 'partial' | 'paid';
      lineItems: Row[];
      matterIds: Set<string>;
      hours: number;
      amount: number;
      expenseItems: Row[];
      expenses: number;
      dtr: DtrRec[];
      mexp: (typeof matterExpenses)[number][];
      reimb: (typeof reimbursements)[number][];
    }
    const plans: Plan[] = [];
    const discountOf = (c: ClientRec) => c.seed.discount ?? 0;
    for (const month of billedMonths) {
      for (const c of this.clients.values()) {
        const entries = this.dtr.filter((e) => e.billable && e.matter.client === c && e.day.startsWith(month));
        if (!entries.length) continue;
        const factor = 1 - discountOf(c) / 100;
        const groups = new Map<Person, { entries: Row[]; hours: number }>();
        for (const e of entries) {
          const withIds = e.row.with_ids as string[];
          const attendees = [e.person, ...[...this.people.values()].filter((p) => withIds.includes(p.personId))];
          for (const a of attendees) {
            const g = groups.get(a) ?? { entries: [], hours: 0 };
            const decimal = Math.round((e.minutes / 60) * 100) / 100;
            g.hours += decimal;
            g.entries.push({
              rawDtrId: e.row.notion_id,
              date: e.day,
              remarks: e.row.remarks,
              task: e.row.task,
              description: `${e.row.task} - ${e.row.remarks}`,
              hours: e.row.hours,
              minutes: e.row.minutes,
              decimalHours: decimal,
              matterId: e.matter.id,
              matterName: e.matter.seed.name,
              matterCode: e.matter.code,
              waived: false,
            });
            groups.set(a, g);
          }
        }
        const lineItems = [...groups.entries()].map(([p, g]) => {
          const rate = Math.round((rateOf.get(p.position) ?? 0) * factor * 100) / 100;
          const hours = Math.round(g.hours * 10) / 10;
          return { lawyerName: p.name, initials: p.initials, position: p.position, hourlyRate: rate, totalHours: hours, amount: Math.round(g.hours * rate * 100) / 100, entries: g.entries };
        });
        const mexp = matterExpenses.filter((x) => x.m.client === c && x.day.startsWith(month));
        const reimb = reimbursements.filter((x) => x.m.client === c && x.day.startsWith(month));
        const expenseItems = [
          ...reimb.map((r) => ({ id: r.id, date: r.day, category: r.category, expense: r.expense, amount: r.amount, matterName: r.m.seed.name, source: 'reimbursement' })),
        ];
        const status: Plan['status'] =
          month === lastBilled && c.seed.key === draftClient ? 'draft'
          : month === lastBilled ? (['paid', 'partial', 'sent', 'sent', 'paid', 'sent'] as const)[plans.length % 6]
          : 'paid';
        plans.push({
          client: c, month, status, lineItems, matterIds: new Set(entries.map((e) => e.matter.id)),
          hours: lineItems.reduce((s, l) => s + l.totalHours, 0),
          amount: Math.round(lineItems.reduce((s, l) => s + l.amount, 0) * 100) / 100,
          expenseItems, expenses: 0, dtr: entries, mexp, reimb,
        });
      }
    }
    const olderClients = ['luntian', 'bantayog', 'amihan', 'kalamansi', 'silab', 'halcyon', 'habilin'];
    olderMonths.forEach((month, mi) => {
      for (const key of olderClients) {
        const c = this.client(key);
        const matters = this.matters.filter((m) => m.client === c && m.opened < `${month}-28` && m.seed.billing !== 'none');
        if (!matters.length) continue;
        const factor = 1 - discountOf(c) / 100;
        const byPerson = new Map<Person, number>();
        for (const m of matters) {
          for (const p of m.team) byPerson.set(p, (byPerson.get(p) ?? 0) + this.rng.int(2, p.seed.role === 'partner' ? 6 : 16));
        }
        const lineItems = [...byPerson.entries()].map(([p, hours]) => {
          const rate = Math.round((rateOf.get(p.position) ?? 0) * factor * 100) / 100;
          return { lawyerName: p.name, initials: p.initials, position: p.position, hourlyRate: rate, totalHours: hours, amount: Math.round(hours * rate * 100) / 100, entries: [] };
        });
        const status: Plan['status'] = key === 'halcyon' && mi === 2 ? 'sent' : key === 'habilin' && mi === 1 ? 'partial' : 'paid';
        plans.push({
          client: c, month, status, lineItems, matterIds: new Set(matters.map((m) => m.id)),
          hours: lineItems.reduce((s, l) => s + l.totalHours, 0),
          amount: Math.round(lineItems.reduce((s, l) => s + l.amount, 0) * 100) / 100,
          expenseItems: [], expenses: 0, dtr: [], mexp: [], reimb: [],
        });
      }
    });

    // Billed flags follow the invoice: anything on a sent invoice is billed.
    for (const plan of plans) {
      const billed = plan.status !== 'draft';
      for (const e of plan.dtr) e.row.billed = billed;
      for (const x of plan.mexp) x.row.billed = billed;
    }
    await this.insert('dtr', this.dtr.map((e) => e.row));

    const mexpRows = await this.insert('matter_expenses', matterExpenses.map((x) => x.row), 'id, matter_id, description, amount, category, expense_date');
    matterExpenses.forEach((x, i) => {
      x.row.id = mexpRows[i]?.id;
    });
    for (const plan of plans) {
      for (const x of plan.mexp) {
        plan.expenseItems.push({ id: `mexp-${x.row.id}`, date: x.day, category: x.row.category, expense: x.row.description, amount: x.row.amount, matterName: null, source: 'finance' });
      }
      plan.expenses = plan.expenseItems.reduce((s, x) => s + Number(x.amount), 0);
    }

    const receiptRows: Row[] = [];
    await pool(reimbursements, 6, async (r, i) => {
      const pdf = await renderRecordPdf({
        heading: 'OFFICIAL RECEIPT',
        lines: [
          `Received from: ${r.p.name} for ${FIRM.name}`,
          `Particulars: ${r.expense}`,
          `Amount: ${peso(r.amount)}`,
          `Date: ${longDate(r.day)}`,
          `Receipt No.: 000${String(4100 + i)}`,
        ],
      });
      const name = `receipt_${slug(r.expense, 30)}.pdf`;
      const key = await this.upload('receipts', `${r.id}/${name}`, pdf, PDF_TYPE);
      const { data: signed } = await this.db.storage.from('receipts').createSignedUrl(key, 60 * 60 * 24 * 365);
      const plan = plans.find((p) => p.reimb.includes(r));
      receiptRows.push({
        notion_id: r.id,
        notion_url: '',
        expense: r.expense,
        amount: r.amount,
        expense_category: r.category,
        expense_date: r.day,
        lawyer_ids: [r.p.personId],
        lawyer_name: r.p.name,
        matter_id: r.m.id,
        matter_name: r.m.seed.name,
        client_id: r.m.client.id,
        client_name: r.m.client.seed.name,
        reimbursed: r.day < this.day(-10),
        billed: !!plan && plan.status !== 'draft',
        created_by_name: r.p.name,
        receipt_urls: [{ name, url: signed?.signedUrl ?? '', path: key }],
        created_time: this.past(r.day, 19),
      });
    });
    await this.insert('reimbursements', receiptRows);

    // Deposits on account, before any invoice is paid from one.
    const depositPlan: [string, number, number][] = [
      ['luntian', 150000, -190], ['bantayog', 100000, -160], ['amihan', 250000, -200],
      ['kalamansi', 50000, -120], ['silab', 100000, -100], ['villareal', 75000, -95],
    ];
    await this.insert(
      'client_deposits',
      depositPlan.map(([key, amount, off]) => ({
        client_id: this.client(key).id,
        client_name: this.client(key).seed.name,
        type: 'deposit',
        amount,
        transaction_date: this.day(off),
        payment_method: 'bank_transfer',
        reference_number: `DEP-${this.client(key).seed.code}-01`,
        notes: 'Initial engagement deposit',
        recorded_by: this.finance.personId,
      })),
    );

    // Invoices, in month order so the allocator numbers them the way finance would have.
    plans.sort((a, b) => a.month.localeCompare(b.month) || a.client.seed.code - b.client.seed.code);
    const payments: Row[] = [];
    let depositApplied = false;
    for (const plan of plans) {
      const { data: number, error: numErr } = await this.db.rpc('allocate_invoice_number', { p_firm_id: this.firmId, p_month: plan.month });
      if (numErr || typeof number !== 'string') throw new Error(`invoices (allocate_invoice_number): ${numErr?.message ?? 'no number returned'}`);
      const next = monthsBefore(plan.month, -1);
      const sent = plan.status === 'draft' ? null : [this.weekday(`${next}-05`), this.today].sort()[0];
      const gross = Math.round((plan.amount + plan.expenses) * 100) / 100;
      const paidAmount = plan.status === 'paid' ? gross : plan.status === 'partial' ? Math.round(gross * 0.5) : 0;
      const paidDate = sent && plan.status === 'paid' ? [addDays(sent, this.rng.int(8, 25)), this.today].sort()[0] : null;
      const matterId = plan.matterIds.size === 1 ? [...plan.matterIds][0] : null;
      const matter = matterId ? this.matters.find((m) => m.id === matterId) : undefined;
      const discount = discountOf(plan.client);
      const [row] = await this.insert(
        'invoices',
        [{
          invoice_number: number,
          client_id: plan.client.id,
          client_name: plan.client.seed.name,
          matter_id: matterId,
          matter_name: matter?.seed.name ?? null,
          billing_month: plan.month,
          total_hours: Math.round(plan.hours * 10) / 10,
          total_amount: plan.amount,
          total_expenses: plan.expenses,
          currency: 'PHP',
          status: plan.status,
          generated_by: this.finance.email,
          line_items: plan.lineItems,
          expense_items: plan.expenseItems,
          fee_lines: [],
          billing_settings: discount ? { hourlyDiscountPercent: String(discount) } : {},
          sent_date: sent,
          due_date: sent ? addDays(sent, 30) : null,
          paid_date: paidDate,
          paid_amount: paidAmount,
          notes: '',
          created_at: this.past(sent ?? this.day(-2), 10),
        }],
        'id, invoice_number',
      );
      const invoiceId = row.id as number;
      if (plan.mexp.length) {
        const { error } = await this.db.from('matter_expenses').update({ invoice_id: invoiceId }).in('id', plan.mexp.map((x) => x.row.id));
        if (error) throw new Error(`matter_expenses (link invoice): ${error.message}`);
      }
      if (plan.reimb.length) {
        const { error } = await this.db.from('reimbursements').update({ invoice_id: invoiceId }).in('notion_id', plan.reimb.map((r) => r.id));
        if (error) throw new Error(`reimbursements (link invoice): ${error.message}`);
      }
      if (paidAmount > 0 && sent) {
        const payDay = paidDate ?? [addDays(sent, 12), this.today].sort()[0];
        const fromDeposit = !depositApplied && plan.status === 'paid' && plan.client.seed.key === 'amihan' ? Math.min(200000, paidAmount) : 0;
        if (fromDeposit > 0) {
          depositApplied = true;
          const ref = `APP-${invoiceId}-${Date.parse(payDay)}`;
          payments.push({ invoice_id: invoiceId, amount: fromDeposit, payment_date: payDay, payment_method: 'deposit', reference_number: ref, notes: 'Applied from client deposit balance', recorded_by: this.finance.personId });
          await this.insert('client_deposits', [{
            client_id: plan.client.id,
            client_name: plan.client.seed.name,
            type: 'application',
            amount: -fromDeposit,
            transaction_date: payDay,
            payment_method: 'deposit',
            reference_number: ref,
            notes: `Applied to invoice ${number}`,
            invoice_id: invoiceId,
            recorded_by: this.finance.personId,
          }]);
        }
        const rest = Math.round((paidAmount - fromDeposit) * 100) / 100;
        if (rest > 0) {
          payments.push({
            invoice_id: invoiceId,
            amount: rest,
            payment_date: payDay,
            payment_method: plans.indexOf(plan) % 3 === 0 ? 'check' : 'bank_transfer',
            reference_number: `${plans.indexOf(plan) % 3 === 0 ? 'CHK' : 'BT'}-000${String(700 + plans.indexOf(plan))}`,
            notes: '',
            recorded_by: this.finance.personId,
          });
        }
      }
    }
    await this.insert('invoice_payments', payments);

    // The firm's own operating expenses, six months of them.
    const payroll = STAFF.reduce((s, x) => s + x.salary, 0);
    const firmExpenses: Row[] = [];
    for (let back = 5; back >= 0; back--) {
      const month = monthsBefore(currentMonth, back);
      const lines: [number, string, number, string, string][] = [
        [1, 'Rent', 250000, 'Building administrator', 'Monthly office rent — 18th floor'],
        [15, 'Payroll', Math.round(payroll / 2), 'Payroll', 'Payroll, first half of the month'],
        [28, 'Payroll', Math.round(payroll / 2), 'Payroll', 'Payroll, second half of the month'],
        [10, 'Utilities', 38000 + this.rng.int(0, 8000), 'Electric and water utilities', 'Electricity and water'],
        [12, 'Software', 18500, 'Practice software subscription', 'Practice management and research subscriptions'],
        [18, 'Office Supplies', 7000 + this.rng.int(0, 5000), 'Office supplier', 'Paper, toner and pantry supplies'],
        [25, 'Bank Charges', 1200, 'Bank', 'Bank service charges'],
      ];
      if (back % 3 === 0) lines.push([20, 'Professional Fees', 65000, 'External auditor', 'Quarterly accounting and audit retainer']);
      for (const [dom, category, amount, vendor, description] of lines) {
        const day = `${month}-${pad2(dom)}`;
        if (day > this.today) continue;
        firmExpenses.push({ expense_date: day, category, amount, vendor, description, payment_method: 'bank_transfer', notes: '', recorded_by: this.finance.personId });
      }
    }
    await this.insert('firm_expenses', firmExpenses);
  }

  // ── 8. Errands ──

  private async seedErrands(): Promise<void> {
    const [chief, officer] = [this.person('rico'), this.person('pascual')];
    const admin = this.person('grace');
    const rows: Row[] = [];
    const courtRuns = this.deliverables.filter((d) => d.work.type === DTYPE.EXTERNAL && (d.status === S.OUTBOX || d.status === S.FILED_OR_SENT_OUT)).slice(0, 12);
    courtRuns.forEach((d, i) => {
      const assignee = i % 2 === 0 ? chief : officer;
      const done = d.status === S.FILED_OR_SENT_OUT;
      const where = d.matter.seed.case?.court ?? (d.work.to?.slice(0, 2).join(', ') || 'the agency');
      const dueDay = done ? d.dateDone! : d.due && d.due >= this.today ? d.due : this.weekday(this.day(1));
      rows.push({
        title: `File ${d.work.title}`,
        purpose: 'Filing',
        description: `File the original and copies with ${where}; serve copies as indicated on the service list.`,
        status: done ? 'completed' : i % 3 === 0 ? 'in_progress' : 'pending',
        priority: done ? 'normal' : 'high',
        scheduled_for: done ? d.dateDone : this.weekday(this.day(i % 2)),
        due_date: dueDay,
        completed_at: done ? this.past(d.dateDone!, 15, 30) : null,
        completion_note: done ? 'Filed; received copy scanned and uploaded.' : '',
        assigned_to: assignee.personId,
        assigned_to_name: assignee.name,
        assigned_by: d.drafters[0].personId,
        assigned_by_name: d.drafters[0].name,
        matter_id: d.matter.id,
        matter_name: d.matter.seed.name,
        client_id: d.matter.client.id,
        client_name: d.matter.client.seed.name,
        deliverable_id: d.id,
        deliverable_name: d.work.title,
      });
    });
    const general: [string, string, string, string][] = [
      ['Secure certified true copies of SEC documents', 'Records', 'bantayog', 'SEC, Makati'],
      ['Pay filing fees at the Office of the Clerk of Court', 'Payment', 'luntian', 'RTC Makati'],
      ['Deliver signed documents to the client', 'Delivery', 'halcyon', 'Client office, Taguig'],
      ['Follow up the certificate of registration with the BIR', 'Follow-up', 'silab', 'BIR RDO, Makati'],
      ['Pick up the business permit from City Hall', 'Pickup', 'bakal', 'Manila City Hall'],
      ['Have the verification pages notarized', 'Notarization', 'kalamansi', 'Notary public, Legazpi Village'],
      ['Pay publication fees for the trademark application', 'Payment', 'palayan', 'IPOPHL, Taguig'],
      ['Deliver visa petition documents', 'Delivery', 'halcyon', 'Bureau of Immigration, Intramuros'],
    ];
    general.forEach(([title, purpose, clientKey, place], i) => {
      const c = this.client(clientKey);
      const m = this.matters.find((x) => x.client === c && x.seed.status === MATTER_STATUS.ONGOING);
      const done = i % 3 === 0;
      const assignee = i % 2 === 0 ? officer : chief;
      const off = done ? -this.rng.int(2, 25) : this.rng.int(0, 10);
      rows.push({
        title,
        purpose,
        description: `${place}.`,
        status: done ? 'completed' : i % 3 === 1 ? 'in_progress' : 'pending',
        priority: i % 4 === 0 ? 'high' : i % 4 === 3 ? 'low' : 'normal',
        scheduled_for: this.weekday(this.day(off), done ? -1 : 1),
        due_date: this.weekday(this.day(off + 2)),
        completed_at: done ? this.past(this.weekday(this.day(off), -1), 16) : null,
        completion_note: done ? 'Done. Receipt submitted to finance.' : '',
        assigned_to: assignee.personId,
        assigned_to_name: assignee.name,
        assigned_by: admin.personId,
        assigned_by_name: admin.name,
        matter_id: m?.id ?? null,
        matter_name: m?.seed.name ?? '',
        client_id: c.id,
        client_name: c.seed.name,
      });
    });
    await this.insert('liaison_tasks', rows);
  }

  // ── 9. Corporate and trademark records ──

  private async seedCorporate(): Promise<void> {
    const creator = this.person('aurora');
    const corpClients: [string, string, string][] = [
      ['luntian', 'Logistics and Warehousing', 'luntian-housekeeping'],
      ['bantayog', 'Real Estate Development', 'sec-2025'],
      ['amihan', 'Business Process Outsourcing', 'amihan-retainer'],
      ['bakal', 'Metal Fabrication', 'bakal-housekeeping'],
      ['silab', 'Power Generation (Holding Company)', 'spa'],
      ['halcyon', 'Software and IT Services', 'post-inc'],
    ];
    const corps: Row[] = [];
    const files: Row[] = [];
    const persons: Row[] = [];
    const uploads: { corp: Row; name: string; category: string; year: number | null }[] = [];
    corpClients.forEach(([key, industry, matterKey], i) => {
      const c = this.client(key);
      const m = this.matter(matterKey);
      const id = crypto.randomUUID();
      const incorporated = this.day(-this.rng.int(900, 3600));
      const capital = [5000000, 10000000, 25000000][i % 3];
      const housekeeping = m.seed.type === 'Corporate Housekeeping';
      corps.push({
        id,
        client_id: c.id,
        engaging_client_id: c.id,
        housekeeping_matter_id: housekeeping ? m.id : null,
        retainer_matter_id: m.seed.type === 'Retainer' ? m.id : null,
        post_incorporation_matter_id: m.seed.type === 'Post-Incorporation' ? m.id : null,
        handles_incorporation: false,
        handles_post_incorporation: m.seed.type === 'Post-Incorporation',
        handles_housekeeping: true,
        is_under_retainer: m.seed.type === 'Retainer',
        approved_name: c.seed.full,
        company_type: 'Stock',
        industry_classification: industry,
        primary_purpose: `To engage in ${industry.toLowerCase()} and all activities incidental to it.`,
        authorized_capital_stock: capital,
        subscribed_capital: capital / 4,
        paid_up_capital: capital / 4,
        par_value: 1,
        number_of_shares: capital,
        principal_office_address: `${10 + i}/F ${c.seed.name.split(' ')[0]} Centre, ${100 + i * 17} Kalayaan Avenue, Makati City`,
        official_email: `corpsec@${c.seed.emailDomain}`,
        official_mobile: `+63 900 111 ${String(c.seed.code).padStart(4, '0')}`,
        sec_registration_no: `CS0000${c.seed.code}`,
        sec_registration_date: incorporated,
        date_of_incorporation: incorporated,
        bir_tin: `000-000-${String(c.seed.code).padStart(3, '0')}-00000`,
        bir_rdo_code: '047',
        bir_cor_date: addDays(incorporated, 30),
        business_permit_no: `BP-${this.today.slice(0, 4)}-000${c.seed.code}`,
        business_permit_lgu: 'Makati City',
        business_permit_issued_date: `${this.today.slice(0, 4)}-01-20`,
        business_permit_expiry_date: `${this.today.slice(0, 4)}-12-31`,
        fiscal_year_end_month: 12,
        annual_meeting_month: [4, 5, 6][i % 3],
        annual_meeting_day: 15,
        status: 'Active',
        created_by: creator.personId,
      });
      const roles: [string, string][] = [['Chairman', 'Chairman of the Board'], ['President', 'President'], ['Director', 'Director'], ['Treasurer', 'Treasurer'], ['Corporate Secretary', 'Corporate Secretary']];
      roles.forEach(([role, title], j) => {
        const [first, last] = CORPORATE_OFFICERS[(i * 2 + j) % CORPORATE_OFFICERS.length].split(' ');
        persons.push({ corporation_id: id, role, first_name: first, last_name: last, position_title: title, nationality: 'Filipino', is_juridical: false, is_current: true, sort_order: j, shares_subscribed_count: role === 'Corporate Secretary' ? 1 : Math.round(capital / 4 / 5) });
      });
      const year = Number(this.today.slice(0, 4));
      const docs: [string, string, number | null][] = [
        ['SEC Certificate of Incorporation', 'SEC COR', null],
        ['Articles of Incorporation', 'AOI', null],
        ['By-Laws', 'By-Laws', null],
        [`General Information Sheet ${year}`, 'GIS', year],
        ['BIR Certificate of Registration', 'BIR COR', null],
        [`Mayor’s Permit ${year}`, 'Business Permit', year],
        [`Audited Financial Statements ${year - 1}`, 'AFS', year - 1],
      ];
      for (const [name, category, fy] of docs) uploads.push({ corp: corps[corps.length - 1], name, category, year: fy });
    });

    // Halcyon's subsidiary, still with the SEC — no client of its own yet.
    const halcyon = this.client('halcyon');
    const subId = crypto.randomUUID();
    corps.push({
      id: subId,
      client_id: null,
      engaging_client_id: halcyon.id,
      incorporation_matter_id: this.matter('incorporation').id,
      handles_incorporation: true,
      proposed_names: ['Halcyon Digital Labs, Inc.', 'Halcyon Labs Philippines, Inc.', 'HDS Labs, Inc.'],
      approved_name: 'Halcyon Digital Labs, Inc.',
      company_type: 'Stock',
      industry_classification: 'Software Development',
      primary_purpose: 'To design, develop and license software and related services.',
      authorized_capital_stock: 4000000,
      subscribed_capital: 1000000,
      paid_up_capital: 250000,
      par_value: 1,
      number_of_shares: 4000000,
      principal_office_address: '9/F Halcyon Centre, 28th Street, Bonifacio Global City, Taguig',
      official_email: `corpsec@${halcyon.seed.emailDomain}`,
      esparc_application_no: 'ESPARC-0000-DEMO',
      esparc_status: 'For SEC Approval',
      esparc_submitted_date: this.day(-12),
      fiscal_year_end_month: 12,
      status: 'In SEC',
      created_by: creator.personId,
    });
    uploads.push({ corp: corps[corps.length - 1], name: 'Name Verification Slip', category: 'Name Verification Slip', year: null });
    uploads.push({ corp: corps[corps.length - 1], name: 'Treasurer’s Affidavit (draft)', category: 'Treasurer Affidavit', year: null });

    await this.insert('corporations', corps);
    // corporation_persons is a read view: a role goes in through the function
    // that decides which person it belongs to (20261121_people.sql).
    for (const p of persons) {
      const { error } = await this.db.rpc('corporation_person_insert', { p_row: p });
      if (error) throw new Error(`corporation_persons: ${error.message}`);
    }
    this.count('corporation_persons', persons.length);
    await pool(uploads, 6, async (u, i) => {
      const pdf = await renderRecordPdf({
        heading: u.name.toUpperCase(),
        issuer: /SEC|Articles|By-Laws|General Information|Audited/.test(u.name) ? 'Securities and Exchange Commission' : /BIR/.test(u.name) ? 'Bureau of Internal Revenue' : /Permit/.test(u.name) ? 'Office of the City Mayor' : undefined,
        lines: [
          `Corporation: ${u.corp.approved_name}`,
          `SEC Registration No.: ${u.corp.sec_registration_no ?? 'pending'}`,
          `Principal office: ${u.corp.principal_office_address}`,
        ],
        body: ['This document is issued for demonstration purposes and evidences no actual registration, filing or corporate act.'],
      });
      // Same folder and name shape as app/api/corporation/[id]/files.
      const key = await this.upload('files', `corporations/${u.corp.id}/${Date.now() + i}-${sanitizeName(u.name)}.pdf`, pdf, PDF_TYPE);
      files.push({ corporation_id: u.corp.id, category: u.category, name: u.name, storage_path: key, mime_type: PDF_TYPE, size_bytes: pdf.length, uploaded_by: creator.personId, filing_year: u.year });
    });
    await this.insert('corporation_files', files);

    // Trademarks: registered marks, marks in prosecution, one still in prep.
    const marks: { client: string; mark: string; classes: number[]; status: string; matter?: string; type: string }[] = [
      { client: 'kalamansi', mark: 'KALAMANSI GROVE', classes: [29, 32], status: 'Registered', matter: 'tm-portfolio', type: 'Combined' },
      { client: 'kalamansi', mark: 'GROVE ZEST', classes: [32], status: 'Pending', matter: 'tm-portfolio', type: 'Wordmark' },
      { client: 'kalamansi', mark: 'ASIM-TAMIS', classes: [30], status: 'Pending - OA', matter: 'tm-portfolio', type: 'Wordmark' },
      { client: 'palayan', mark: 'PALAYAN FRESH', classes: [31], status: 'Pending - OA', matter: 'palayan-tm', type: 'Wordmark' },
      { client: 'bantayog', mark: 'BANTAYOG', classes: [36, 37], status: 'Registered', matter: 'opposition', type: 'Wordmark' },
      { client: 'halcyon', mark: 'HALCYONPAY', classes: [9, 42], status: 'For Filing', type: 'Wordmark' },
      { client: 'dalampasigan', mark: 'DALAMPASIGAN BAY', classes: [43], status: 'Registered', type: 'Combined' },
      { client: 'lunas', mark: 'LUNASCREST', classes: [5, 35], status: 'Prelim', type: 'Device' },
    ];
    const indexByClient = new Map<string, number>();
    const tmRows: Row[] = [];
    const tmFiles: { tm: Row; name: string }[] = [];
    const oaRows: Row[] = [];
    for (const t of marks) {
      const c = this.client(t.client);
      const idx = (indexByClient.get(t.client) ?? 0) + 1;
      indexByClient.set(t.client, idx);
      const m = t.matter ? this.matter(t.matter) : undefined;
      const filed = t.status === 'Prelim' || t.status === 'For Filing' ? null : this.day(-this.rng.int(150, 900));
      const row: Row = {
        id: crypto.randomUUID(),
        matter_id: m?.id ?? null,
        matter_name: m?.seed.name ?? '',
        client_id: c.id,
        client_name: c.seed.name,
        client_code: c.seed.code,
        client_index: idx,
        mark: t.mark,
        type: t.type,
        classes: t.classes,
        country: 'PH',
        owner: c.seed.full,
        contact_email: `legal@${c.seed.emailDomain}`,
        status: t.status,
        filing_date: filed,
        reg_ir_no: filed ? `4-${filed.slice(0, 4)}-0${String(500000 + c.seed.code * 7 + idx)}` : null,
        gpoa_status: filed ? 'Filed' : 'To Follow',
        gpoa_filed_date: filed,
        reg_date: t.status === 'Registered' && filed ? addDays(filed, 240) : null,
        notes: t.status === 'Pending - OA' ? 'Office action cites a prior mark in the same class; response in progress.' : null,
        created_by: this.person('katrina').personId,
      };
      tmRows.push(row);
      if (t.status === 'Pending - OA') {
        const mailed = this.day(-this.rng.int(12, 40));
        oaRows.push({ trademark_id: row.id, mailing_date: mailed, received_date: addDays(mailed, 2), created_by: row.created_by });
      }
      const docs = t.status === 'Prelim' ? ['Registrability Search Report'] : ['Application Form', 'Specimen of Use', 'General Power of Attorney'];
      for (const name of docs) tmFiles.push({ tm: row, name });
    }
    await this.insert('trademarks', tmRows);
    await this.insert('trademark_office_actions', oaRows);
    const tmFileRows: Row[] = [];
    await pool(tmFiles, 6, async ({ tm, name }, i) => {
      const pdf = await renderRecordPdf({
        heading: name.toUpperCase(),
        issuer: name === 'Registrability Search Report' ? undefined : 'Intellectual Property Office of the Philippines',
        lines: [`Mark: ${tm.mark}`, `Applicant: ${tm.owner}`, `Classes: ${(tm.classes as number[]).join(', ')}`, `Application No.: ${tm.reg_ir_no ?? 'not yet filed'}`],
        body: ['Demonstration document only. No application, registration or filing is evidenced by it.'],
      });
      const key = await this.upload('files', `trademarks/${tm.id}/${Date.now() + i}_${sanitizeName(name)}.pdf`, pdf, PDF_TYPE);
      tmFileRows.push({ trademark_id: tm.id, name: `${name} — ${tm.mark}`, storage_path: key, mime_type: PDF_TYPE, size_bytes: pdf.length, uploaded_by: this.person('katrina').personId });
    });
    await this.insert('trademark_files', tmFileRows);
  }

  // ── 10. Incoming court records and correspondence ──

  private async seedIncoming(): Promise<void> {
    const kinds: [string, string, boolean][] = [
      ['Order', 'Court', true],
      ['Notice of Hearing', 'Court', true],
      ['Resolution', 'Court', true],
      ['Motion for Extension of Time', 'Defendant', false],
      ['Comment/Opposition', 'Defendant', false],
      ['Letter', 'Client', false],
      ['Entry of Appearance', 'Defendant', false],
    ];
    const cases = this.ongoing.filter((m) => m.seed.case);
    const others = this.ongoing.filter((m) => !m.seed.case);
    const lawyers = [...this.people.values()].filter((p) => p.seed.feeEarner);
    const staffIds = [...this.people.values()].map((p) => p.personId);
    const items: { id: string; m: MatterRec; name: string; origin: string; court: boolean; received: string; kind: string }[] = [];
    for (let i = 0; i < 44; i++) {
      const caseFile = i % 4 !== 3;
      const m = caseFile ? cases[(i * 3) % cases.length] : others[(i * 5) % others.length];
      const [kind, defaultOrigin, court] = caseFile ? kinds[i % kinds.length] : kinds[5];
      let origin = defaultOrigin;
      if (caseFile && !court && m.seed.case) {
        origin = m.seed.case.clientFiled ? (m.seed.case.forum === 'ipophl' ? 'Respondent' : 'Defendant') : 'Complainant';
      }
      const received = this.weekday(this.day(-(i < 6 ? this.rng.int(this.recent, 3) : this.rng.int(4, 90))), -1);
      const name = caseFile
        ? `${kind} — ${m.code}`
        : [`Letter from ${m.client.seed.contact} — ${m.seed.name}`, `Signed documents from ${m.client.seed.name} — ${m.seed.name}`, `Client comments on the draft — ${m.seed.name}`][i % 3];
      items.push({ id: mintId('file'), m, name, origin, court, received, kind });
    }

    const rows: Row[] = [];
    await pool(items, 6, async (it, i) => {
      const next = this.hearings.filter((h) => h.matter === it.m && h.day > it.received).sort((a, b) => a.day.localeCompare(b.day))[0];
      const c = it.m.seed.case;
      const pdf = await renderRecordPdf({
        heading: it.kind.toUpperCase(),
        issuer: it.court ? c?.court : undefined,
        lines: [
          `Case: ${c ? (c.clientFiled ? `${it.m.client.seed.full} v. ${c.adverse}` : `${c.adverse} v. ${it.m.client.seed.full}`) : it.m.seed.name}`,
          `Docket: ${c?.docket ?? it.m.code}`,
          `Date: ${longDate(it.received)}`,
        ],
        body: incomingBody(it.kind, it.court, next ? `${longDate(next.day)} at ${next.at.slice(11, 16)}` : null),
      });
      const fileName = `${sanitizeName(it.name)}.pdf`;
      const key = await this.upload('files', `${it.id}/${fileName}`, pdf, PDF_TYPE);
      const recent = i < 6;
      const readers = recent ? [] : staffIds.filter((_, j) => (j + i) % 3 !== 0);
      const acted = !recent && i % 3 === 0;
      rows.push({
        notion_id: it.id,
        notion_url: '',
        name: it.name,
        matter_id: null,
        matter_name: it.m.seed.name,
        origin: it.origin,
        action_taken: acted ? ['Internal Discussion', 'Prepare Response', 'Prepare Status Report'][i % 3] : '',
        date_received: it.received,
        document_date: addDays(it.received, -this.rng.int(1, 4)),
        is_court_record: it.court,
        file_urls: [{ name: fileName, url: '', path: key }],
        sharepoint_urls: [],
        acted_upon_by_ids: acted ? [lawyers[i % lawyers.length].personId] : [],
        persons_read_ids: readers,
        deliverable_name: '',
        created_time: this.past(it.received, 10, 15),
      });
    });
    await this.insert('files', rows);
    await pool(items, 8, async (it) => {
      await this.update('files', { matter_id: it.m.id }, 'notion_id', it.id);
      this.touch(it.m.id, this.past(it.received, 10, 15));
    });
  }

  // ── 11. Announcements, notifications, chat ──

  private async seedCommunications(): Promise<void> {
    const announcements: [string, string, number][] = [
      ['Reminder: DTR cutoff', 'Please encode all time entries for the month by the 3rd so billing can close on schedule.', -2],
      ['Year-end planning session', 'Partners and associates: the planning session is on the last Friday of next month, 2:00 pm, conference room. Bring your matter lists.', -5],
      ['New pantry rules', 'Kindly label personal items in the refrigerator. The pantry is cleaned every Friday afternoon.', -12],
      ['Welcome, Sofia Alcantara', 'Sofia joins us as an underbar associate with the corporate group. Please make her feel at home.', -30],
      ['Updated filing checklist', 'The liaison team has updated the court filing checklist. Use the new version for every filing from today.', -45],
    ];
    await this.insert(
      'announcements',
      announcements.map(([name, content, off]) => ({
        notion_id: mintId('announcement'),
        notion_url: '',
        name,
        content,
        announcement_date: this.day(off),
        type: 'General',
        created_time: this.past(this.day(off), 9),
      })),
    );

    const find = (pred: (d: DeliverableRec) => boolean) => this.deliverables.find(pred);
    const byMatter = (key: string) => (d: DeliverableRec) => d.matter.seed.key === key;
    const isabel = this.person('isabel');
    const diego = this.person('diego');
    const note = (person: Person, type: string, title: string, href: string, entityId: string | null, read: boolean, hoursAgo: number, body: string | null = null): Row => ({
      person_id: person.personId,
      type,
      title,
      body,
      href,
      entity_id: entityId,
      read,
      created_at: isoManila(Date.now() - hoursAgo * 3600_000),
    });
    const rows: Row[] = [];
    const inReview = find((d) => d.status === S.UNDER_REVIEW && d.reviewers.includes(isabel) && !d.work.affidavitFixture);
    const fixture = find((d) => !!d.work.affidavitFixture);
    const nextHearing = this.hearings.filter((h) => h.day >= this.today && h.status === HEARING_SCHEDULED).sort((a, b) => a.at.localeCompare(b.at));
    const isabelHearing = nextHearing.find((h) => h.attendees.includes(isabel));
    const diegoHearing = nextHearing.find((h) => h.attendees.includes(diego));
    const revising = find((d) => d.status === S.REVISING && d.drafters.includes(diego));
    const dueSoon = this.deliverables.filter((d) => d.drafters.includes(diego) && d.due && d.due >= this.today && d.dateDone === null).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))[0];
    const outbox = find((d) => d.status === S.OUTBOX);
    const replevin = find(byMatter('replevin'));
    const leave = this.person('paolo');

    if (inReview) rows.push(note(isabel, 'assignment', `${inReview.work.title} is with you for review`, `/dashboard/deliverables/${inReview.id}`, inReview.id, false, 3, inReview.matter.seed.name));
    if (isabelHearing) rows.push(note(isabel, 'hearing', `Upcoming: ${isabelHearing.name}`, `/dashboard/hearings/${isabelHearing.id}`, isabelHearing.id, false, 20, `${longDate(isabelHearing.day)} · ${isabelHearing.matter.seed.case?.court ?? ''}`));
    rows.push(note(isabel, 'leave_request', `${leave.name} requested vacation leave`, '/dashboard/partner/leaves', null, false, 26));
    if (fixture) rows.push(note(isabel, 'mention', `${diego.name} mentioned you on ${fixture.work.title}`, `/dashboard/deliverables/${fixture.id}`, fixture.id, true, 50, 'Can you check Q5 to Q10 before I finalize? I think a few of them are objectionable.'));
    if (replevin) rows.push(note(isabel, 'finalized', `${replevin.work.title} finalized — ready to send out`, `/dashboard/deliverables/${replevin.id}`, replevin.id, true, 120));

    if (revising) rows.push(note(diego, 'status_change', `${revising.work.title} was returned for revision`, `/dashboard/deliverables/${revising.id}`, revising.id, false, 5, revising.steps[revising.steps.length - 1]?.step.comment ?? null));
    if (dueSoon) rows.push(note(diego, 'deadline', `Due ${dueSoon.due === this.today ? 'today' : `on ${longDate(dueSoon.due!)}`}: ${dueSoon.work.title}`, `/dashboard/deliverables/${dueSoon.id}`, dueSoon.id, false, 8));
    if (diegoHearing) rows.push(note(diego, 'hearing', `Upcoming: ${diegoHearing.name}`, `/dashboard/hearings/${diegoHearing.id}`, diegoHearing.id, false, 18));
    if (fixture) rows.push(note(diego, 'mention', `${isabel.name} replied to your comment on ${fixture.work.title}`, `/dashboard/deliverables/${fixture.id}`, fixture.id, true, 30));

    const finance = this.finance;
    const halcyon = this.matters.find((m) => m.client.seed.key === 'halcyon');
    rows.push(note(finance, 'mention', `${isabel.name} mentioned you in ${halcyon?.seed.name ?? 'a matter chat'}`, halcyon ? `/dashboard/matters/${halcyon.id}` : '/dashboard/chat', halcyon?.id ?? null, false, 6, 'Please send Halcyon a statement of account this week — the older invoice is still open.'));
    rows.push(note(finance, 'status_change', 'The DTR cutoff for the month is on the 3rd', '/finance/dtr-review', null, true, 40));

    const grace = this.person('grace');
    rows.push(note(grace, 'meeting', 'Monday Docket Review', '/dashboard/meetings', null, false, 22, 'Firm conference room, 8:30 am'));
    rows.push(note(grace, 'mention', `${this.person('rico').name} mentioned you on an errand`, '/dashboard/liaison-schedule', null, true, 60, 'Need petty cash for tomorrow’s filing fees.'));

    const rico = this.person('rico');
    if (outbox) rows.push(note(rico, 'deadline', `For filing: ${outbox.work.title}`, `/dashboard/deliverables/${outbox.id}`, outbox.id, false, 4, outbox.matter.seed.case?.court ?? outbox.matter.seed.name));
    rows.push(note(rico, 'assignment', 'New errand: Secure certified true copies of SEC documents', '/dashboard/liaison-schedule', null, false, 9));
    rows.push(note(rico, 'hearing', `Court run on ${nextHearing[0] ? longDate(nextHearing[0].day) : 'the next setting'}: ${nextHearing[0]?.name ?? 'hearing'}`, nextHearing[0] ? `/dashboard/hearings/${nextHearing[0].id}` : '/dashboard/hearings', nextHearing[0]?.id ?? null, true, 28));
    await this.insert('notifications', rows);

    // Matter chat — the trigger opened one channel per matter; post into them.
    const { data: channels, error } = await this.db.from('chat_channels').select('id, matter_id').eq('type', 'matter');
    if (error) throw new Error(`chat_channels: ${error.message}`);
    const channelOf = new Map((channels ?? []).map((c: Row) => [c.matter_id as string, c.id as string]));
    const lines = [
      'Uploaded the signed verification page to the deliverable.',
      'Court reset the hearing — I have updated the calendar.',
      'Client confirmed the figures in Annex B.',
      'Filing receipt attached; we are good for today.',
      'Can someone cover the 9 am setting? I have a conflict.',
      'I can take it. Please leave the folder at my desk.',
      'Draft is in for review.',
      'Thanks — reviewing tonight.',
    ];
    const messages: Row[] = [];
    this.ongoing.slice(0, 12).forEach((m, i) => {
      const channel = channelOf.get(m.id);
      if (!channel) throw new Error(`chat_channels: no channel was opened for ${m.seed.name}`);
      const n = 3 + (i % 3);
      const startOff = -this.rng.int(4, 20);
      for (let j = 0; j < n; j++) {
        const sender = m.team[(i + j) % m.team.length];
        const created = this.past(this.day(Math.min(-this.recent, startOff + j * 2)), 9 + ((i + j * 3) % 9), this.rng.int(0, 59));
        messages.push({ channel_id: channel, sender_id: sender.personId, content: lines[(i + j) % lines.length], mentions: [], created_at: created });
        this.touch(m.id, created);
      }
    });
    if (halcyon) {
      const channel = channelOf.get(halcyon.id);
      const created = isoManila(Date.now() - 6 * 3600_000);
      messages.push({ channel_id: channel, sender_id: isabel.personId, content: `@${finance.seed.nickname} please send Halcyon a statement of account this week — the older invoice is still open.`, mentions: [finance.personId], created_at: created });
      this.touch(halcyon.id, created);
    }
    await this.insert('chat_messages', messages);
  }

  // ── 12. Matter activity ──

  private async settleActivity(): Promise<void> {
    await pool(this.matters, 8, async (m) => {
      const t = this.lastActivity.get(m.id) ?? Date.parse(this.at(m.opened, 10));
      await this.update('matters', { last_activity_at: isoManila(t) }, 'notion_id', m.id);
    });
  }

  // ── Run ──

  async run(adminEmail: string): Promise<void> {
    await this.seedTeam(adminEmail);
    await this.seedFirmSettings();
    await this.seedClientsAndMatters();
    this.planHearings();
    await this.seedDeliverables();
    await this.seedCalendar();
    await this.seedLeaves();
    this.planDtr();
    await this.seedMoney();
    await this.seedErrands();
    await this.seedCorporate();
    await this.seedIncoming();
    await this.seedCommunications();
    await this.settleActivity();

    for (const [table, n] of this.counts) console.log(`  ${table.padEnd(34)} ${n}`);
    console.log(`  ${'storage objects'.padEnd(34)} ${this.storageObjects}`);
  }
}

export async function seedDemoContent(opts: {
  firmId: string;
  adminEmail: string;
}): Promise<{ personas: Record<DemoPersonaKey, string> }> {
  const seeder = new DemoSeeder(opts.firmId);
  await seeder.run(opts.adminEmail);
  return { personas: seeder.personas };
}
