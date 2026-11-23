'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronDown } from 'lucide-react';
import type { Corporation } from '@/types/corporations';
import DatePickerInput from '@/components/DatePickerInput';
import CellDropdown from '@/components/admin/CellDropdown';
import { parseAmount, parseCount } from '@/lib/parse-amount';
import { registrationEffects } from '@/lib/corporation-lifecycle';
import AffiliationsEditor from './AffiliationsEditor';
import CorporationMatterLinks from './CorporationMatterLinks';
import { FIRM_FILINGS } from '@/lib/corporations/obligations';

interface Props {
  corporation: Corporation;
  matterNames: Record<string, string>;
  clientNames: Record<string, string>;
  onUpdated?: (corporation: Corporation) => void;
  /** Render one section alone. */
  only?: 'sec';
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ESPARC_STATUSES = [
  'Not Started', 'Name Verification', 'Drafting', 'For Payment', 'For SEC Approval', 'Approved', 'Rejected',
];

const COMPANY_TYPES = [
  { id: 'Stock', label: 'Stock' },
  { id: 'Non-Stock', label: 'Non-Stock' },
  { id: 'OPC', label: 'One-Person Corporation (OPC)' },
  { id: 'Partnership', label: 'Partnership' },
];

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Shared PATCH-one-field helper: shows the edit at once, then the server's row, or rolls back. */
function useFieldSaver(corporation: Corporation, onUpdated?: (c: Corporation) => void) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState('');

  async function save(field: string, value: unknown): Promise<boolean> {
    const previous = corporation;
    setStatus('saving');
    setError('');
    onUpdated?.({ ...corporation, [field]: value } as Corporation);
    try {
      const res = await fetch(`/api/corporation/${corporation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.corporation) {
        onUpdated?.(previous);
        setStatus('error');
        setError(data.error ?? 'Save failed');
        return false;
      }
      onUpdated?.(data.corporation as Corporation);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 1200);
      return true;
    } catch (e) {
      onUpdated?.(previous);
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Unexpected error');
      return false;
    }
  }

  return { status, error, save };
}

function SaveIndicator({ status, error }: { status: SaveStatus; error: string }) {
  return (
    <div className="text-xs">
      {status === 'saving' && <span className="text-stone-500 dark:text-stone-400">Saving…</span>}
      {status === 'saved' && (
        <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Saved
        </span>
      )}
      {status === 'error' && <span className="text-rose-600 dark:text-rose-400" title={error}>{error || 'Save failed'}</span>}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 items-center py-1.5 border-b border-stone-100 dark:border-white/10">
      <span className="text-xs text-stone-500 dark:text-stone-400 col-span-1">{label}</span>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

/** Save-on-blur text input; reverts to the last-saved value when the PATCH fails. */
function TextField({
  label, value, mono, multiline, onSave,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  multiline?: boolean;
  onSave: (v: string | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const lastSaved = useRef(value ?? '');

  // Mirror external updates — a COR extraction writing sec_registration_no
  // reaches this field as a new prop, and without this the input would keep
  // rendering its stale initial draft. Skipped while the user has an
  // uncommitted edit so an incoming change can't stomp what they're typing.
  useEffect(() => {
    const incoming = value ?? '';
    if (incoming === lastSaved.current) return;
    if (draft !== lastSaved.current) return;
    lastSaved.current = incoming;
    setDraft(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function commit() {
    const next = draft.trim();
    if (next === lastSaved.current.trim()) return;
    const ok = await onSave(next === '' ? null : next);
    if (ok) lastSaved.current = next;
    else setDraft(lastSaved.current);
  }

  const cls = `w-full px-2 py-1 text-sm border border-stone-200 dark:border-white/10 rounded outline-none focus:border-navy-600 ${mono ? 'font-mono' : ''}`;
  return (
    <FieldRow label={label}>
      {multiline ? (
        <textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} className={cls} />
      ) : (
        <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} className={cls} />
      )}
    </FieldRow>
  );
}

/** Save-on-blur numeric input tolerant of comma/peso formatting. */
function NumberField({
  label, value, integer, onSave,
}: {
  label: string;
  value: number | null;
  integer?: boolean;
  onSave: (v: number | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value?.toLocaleString('en-PH') ?? '');
  const [invalid, setInvalid] = useState(false);
  const lastSaved = useRef(value);

  // Same prop mirror as TextField — see the note there.
  useEffect(() => {
    if (value === lastSaved.current) return;
    if (draft !== (lastSaved.current?.toLocaleString('en-PH') ?? '')) return;
    lastSaved.current = value;
    setDraft(value?.toLocaleString('en-PH') ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function commit() {
    const parsed = integer ? parseCount(draft) : parseAmount(draft);
    if (draft.trim() !== '' && parsed == null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed === lastSaved.current) return;
    const ok = await onSave(parsed);
    if (ok) {
      lastSaved.current = parsed;
      setDraft(parsed?.toLocaleString('en-PH') ?? '');
    } else {
      setDraft(lastSaved.current?.toLocaleString('en-PH') ?? '');
    }
  }

  return (
    <FieldRow label={label}>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        className={`w-full px-2 py-1 text-sm font-mono border rounded outline-none focus:border-navy-600 ${invalid ? 'border-rose-400' : 'border-stone-200 dark:border-white/10'}`}
      />
      {invalid && <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">Not a number — value not saved</p>}
    </FieldRow>
  );
}

function DateField({
  label, value, onSave, hint,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => Promise<boolean>;
  hint?: string;
}) {
  return (
    <FieldRow label={label}>
      <DatePickerInput variant="cell" value={value} onChange={(v) => { void onSave(v); }} />
      {hint && <p className="mt-0.5 text-[11px] text-stone-400 dark:text-stone-500">{hint}</p>}
    </FieldRow>
  );
}

/** Single-select on the anchored CellDropdown (native <select> is banned). */
function SelectField({
  label, value, options, placeholder, onSave,
}: {
  label: string;
  value: string | null;
  options: { id: string; label: string }[];
  placeholder?: string;
  onSave: (v: string | null) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.id === value);
  return (
    <FieldRow label={label}>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-2 py-1 text-sm border border-stone-200 dark:border-white/10 rounded bg-white dark:bg-card hover:border-stone-300 dark:hover:border-white/15 text-left"
      >
        <span className={current ? 'text-stone-800 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'}>
          {current?.label ?? placeholder ?? '— Select —'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={options}
          onSelect={(id) => {
            setOpen(false);
            void onSave(id);
          }}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
        />
      )}
    </FieldRow>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 border-b border-stone-100 dark:border-white/10 text-sm">
      <span className="text-stone-500 dark:text-stone-400 col-span-1">{label}</span>
      <span className={`col-span-2 ${mono ? 'font-mono' : ''} text-stone-800 dark:text-stone-100`}>{value || <span className="text-stone-400 dark:text-stone-500">—</span>}</span>
    </div>
  );
}

function LinkRow({ label, href, name }: { label: string; href: string | null; name: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 border-b border-stone-100 dark:border-white/10 text-sm">
      <span className="text-stone-500 dark:text-stone-400 col-span-1">{label}</span>
      <span className="col-span-2 text-stone-800 dark:text-stone-100">
        {href && name ? (
          <Link href={href} className="text-navy-700 dark:text-navy-300 hover:underline">{name}</Link>
        ) : (
          <span className="text-stone-400 dark:text-stone-500">—</span>
        )}
      </span>
    </div>
  );
}

export default function CorporationOverviewTab({ corporation, matterNames, clientNames, onUpdated, only }: Props) {
  const identity = useFieldSaver(corporation, onUpdated);
  const sec = useFieldSaver(corporation, onUpdated);
  const capital = useFieldSaver(corporation, onUpdated);
  const gis = useFieldSaver(corporation, onUpdated);

  const clientLabel = (id: string | null) => (id ? (clientNames[id] ?? `Client #${id.slice(-8)}`) : null);

  const secSection = (
      <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">SEC Registration</h3>
          <SaveIndicator status={sec.status} error={sec.error} />
        </div>
        <SelectField
          label="eSPARC Status"
          value={corporation.esparcStatus}
          options={ESPARC_STATUSES.map((s) => ({ id: s, label: s }))}
          onSave={(v) => sec.save('esparcStatus', v)}
        />
        <div data-field="esparcApplicationNo">
          <TextField label="eSPARC App. No." value={corporation.esparcApplicationNo} mono onSave={(v) => sec.save('esparcApplicationNo', v)} />
        </div>
        <DateField label="eSPARC Submitted" value={corporation.esparcSubmittedDate} onSave={(v) => sec.save('esparcSubmittedDate', v)} />
        <TextField label="SEC Reg. No." value={corporation.secRegistrationNo} mono onSave={(v) => sec.save('secRegistrationNo', v)} />
        <DateField
          label="SEC Reg. Date"
          value={corporation.secRegistrationDate}
          onSave={(v) => sec.save('secRegistrationDate', v)}
          hint={corporation.secRegistrationDate
            ? undefined
            : registrationEffects(corporation, 'Setting this for the first time')}
        />
      </section>
  );
  // Before registration the Overview shows the intake form; the eSPARC
  // application fields it lacks come from here.
  if (only === 'sec') return secSection;

  return (
    <div className="columns-1 md:columns-2 gap-4 [&>*]:break-inside-avoid [&>*]:mb-4">
      <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Identity</h3>
          <SaveIndicator status={identity.status} error={identity.error} />
        </div>
        <TextField label="Approved Name" value={corporation.approvedName} onSave={(v) => identity.save('approvedName', v)} />
        <Row label="Working Name" value={corporation.proposedNames[0] ?? null} />
        <TextField label="Industry" value={corporation.industryClassification} onSave={(v) => identity.save('industryClassification', v)} />
        <TextField label="Primary Purpose" value={corporation.primaryPurpose} multiline onSave={(v) => identity.save('primaryPurpose', v)} />
        <TextField label="Principal Office" value={corporation.principalOfficeAddress} multiline onSave={(v) => identity.save('principalOfficeAddress', v)} />
        <SelectField
          label="Fiscal Year End"
          value={String(corporation.fiscalYearEndMonth)}
          options={MONTHS.map((m, i) => ({ id: String(i + 1), label: m }))}
          onSave={(v) => identity.save('fiscalYearEndMonth', v ? Number(v) : 12)}
        />
        <TextField label="Notes" value={corporation.notes} multiline onSave={(v) => identity.save('notes', v)} />
      </section>

      {secSection}

      <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Contact &amp; Filing Details</h3>
          <SaveIndicator status={gis.status} error={gis.error} />
        </div>
        <p className="text-[11px] text-stone-500 dark:text-stone-400 mb-3">
          Everything the SEC General Information Sheet asks for. Filled in here, it lands on the
          generated GIS automatically.
        </p>
        <TextField label="Business/Trade Name" value={corporation.businessTradeName} onSave={(v) => gis.save('businessTradeName', v)} />
        <TextField label="Official Email" value={corporation.officialEmail} onSave={(v) => gis.save('officialEmail', v)} />
        <TextField label="Alternate Email" value={corporation.alternateEmail} onSave={(v) => gis.save('alternateEmail', v)} />
        <TextField label="Official Mobile" value={corporation.officialMobile} onSave={(v) => gis.save('officialMobile', v)} />
        <TextField label="Alternate Mobile" value={corporation.alternateMobile} onSave={(v) => gis.save('alternateMobile', v)} />
        <TextField label="Telephone No." value={corporation.telephoneNumber} onSave={(v) => gis.save('telephoneNumber', v)} />
        <TextField label="Fax No." value={corporation.faxNumber} onSave={(v) => gis.save('faxNumber', v)} />
        <TextField label="Website" value={corporation.website} onSave={(v) => gis.save('website', v)} />
        <TextField
          label="Annual Meeting per By-Laws"
          value={corporation.annualMeetingBylaws}
          onSave={(v) => gis.save('annualMeetingBylaws', v)}
        />
        <div data-field="annualMeetingMonth">
        <SelectField
          label="Meeting Month"
          value={corporation.annualMeetingMonth ? String(corporation.annualMeetingMonth) : null}
          options={MONTHS.map((m, i) => ({ id: String(i + 1), label: m }))}
          placeholder="— Not set —"
          onSave={(v) => gis.save('annualMeetingMonth', v ? Number(v) : null)}
        />
        </div>
        <NumberField
          label="Meeting Day"
          value={corporation.annualMeetingDay}
          integer
          onSave={(v) => gis.save('annualMeetingDay', v)}
        />
        <p className="text-[11px] text-stone-500 dark:text-stone-400 -mt-1 mb-3">
          The by-laws meeting date as a month and day. Set both and the GIS deadline is
          calendared 30 days after that meeting; leave either blank and it falls back to 30
          days after fiscal year end, which is only a placeholder.
        </p>
        <TextField label="Geographical Code" value={corporation.geographicalCode} mono onSave={(v) => gis.save('geographicalCode', v)} />
        <TextField label="External Auditor" value={corporation.externalAuditorName} onSave={(v) => gis.save('externalAuditorName', v)} />
        <TextField
          label="Auditor SEC Accreditation No."
          value={corporation.externalAuditorAccreditationNo}
          mono
          onSave={(v) => gis.save('externalAuditorAccreditationNo', v)}
        />
        <NumberField label="Total Assets (PHP)" value={corporation.totalAssets} onSave={(v) => gis.save('totalAssets', v)} />
        <DateField label="Total Assets As Of" value={corporation.totalAssetsAsOf} onSave={(v) => gis.save('totalAssetsAsOf', v)} />
      </section>

      <AffiliationsEditor corporation={corporation} />

      <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Capital Structure</h3>
          <SaveIndicator status={capital.status} error={capital.error} />
        </div>
        <SelectField
          label="Company Type"
          value={corporation.companyType}
          options={COMPANY_TYPES}
          onSave={(v) => capital.save('companyType', v)}
        />
        <NumberField label="Authorized Capital Stock (PHP)" value={corporation.authorizedCapitalStock} onSave={(v) => capital.save('authorizedCapitalStock', v)} />
        <NumberField label="Subscribed Capital (PHP)" value={corporation.subscribedCapital} onSave={(v) => capital.save('subscribedCapital', v)} />
        <NumberField label="Paid-up Capital (PHP)" value={corporation.paidUpCapital} onSave={(v) => capital.save('paidUpCapital', v)} />
        <NumberField label="Par Value (PHP)" value={corporation.parValue} onSave={(v) => capital.save('parValue', v)} />
        <NumberField label="Number of Shares" value={corporation.numberOfShares} integer onSave={(v) => capital.save('numberOfShares', v)} />
      </section>

      <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-3">Linkage & Scope</h3>
        <LinkRow
          label="Own Client"
          href={corporation.clientId ? `/dashboard/clients/${corporation.clientId}` : null}
          name={clientLabel(corporation.clientId)}
        />
        <LinkRow
          label="Engaging Client"
          href={corporation.engagingClientId ? `/dashboard/clients/${corporation.engagingClientId}` : null}
          name={clientLabel(corporation.engagingClientId)}
        />
        <CorporationMatterLinks corporation={corporation} matterNames={matterNames} onUpdated={onUpdated} />
        <ScopeEditor corporation={corporation} onUpdated={onUpdated} />
      </section>
    </div>
  );
}

/**
 * What the firm does for the company. Which matter bills each part is the
 * "Covered by" list above — a retainer matter there is what "under retainer"
 * means, so it has no toggle of its own.
 */
function ScopeEditor({ corporation, onUpdated }: { corporation: Corporation; onUpdated?: (c: Corporation) => void }) {
  const { status, error, save } = useFieldSaver(corporation, onUpdated);
  const toggles: { field: string; label: string; value: boolean }[] = [
    { field: 'handlesIncorporation', label: 'Incorporation', value: corporation.handlesIncorporation },
    { field: 'handlesPostIncorporation', label: 'Post-Incorporation', value: corporation.handlesPostIncorporation },
    { field: 'handlesHousekeeping', label: 'Housekeeping', value: corporation.handlesHousekeeping },
  ];
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-stone-600 dark:text-stone-300">Engagement scope</span>
        <SaveIndicator status={status} error={error} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {toggles.map((t) => (
          <label key={t.field} className="inline-flex items-center gap-1.5 text-xs text-stone-700 dark:text-stone-200 cursor-pointer">
            <input
              type="checkbox"
              checked={t.value}
              onChange={(e) => { void save(t.field, e.target.checked); }}
            />
            {t.label}
          </label>
        ))}
      </div>
      <div className="mt-3 text-xs font-medium text-stone-600 dark:text-stone-300">Filings we handle</div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {FIRM_FILINGS.map((f) => (
          <label key={f.key} className="inline-flex items-center gap-1.5 text-xs text-stone-700 dark:text-stone-200 cursor-pointer">
            <input
              type="checkbox"
              checked={corporation.firmFiles.includes(f.key)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...corporation.firmFiles, f.key]
                  : corporation.firmFiles.filter((k) => k !== f.key);
                void save('firmFiles', next);
              }}
            />
            {f.label}
          </label>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">
        Ticked filings are tracked and raised every year; the rest show as not ours.
      </p>
    </div>
  );
}
