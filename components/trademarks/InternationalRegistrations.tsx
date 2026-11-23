'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, Globe2, Loader2, Plus, Trash2 } from 'lucide-react';
import type { Trademark } from '@/types/notion';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import DatePickerInput from '@/components/DatePickerInput';
import { DueChip, SubjectCard } from '@/components/ui/primitives';
import { EditableDate, InlineText } from '@/components/ui/inline-edit';
import { BTN_GHOST_DANGER, BTN_OUTLINE } from '@/components/ui/tone';
import { TrademarkStatusPill } from '@/components/trademarks/ui';
import { dependencyEnds, irRenewalPeriod, transformationDeadline, upcomingDeadlines } from '@/lib/trademark-deadlines';
import { countryName, parseCountries } from '@/lib/trademarks/countries';
import type { RegistrationWithDesignations } from '@/lib/trademarks/international';
import { deadlineLabel } from '@/lib/trademarks/actions';
import { formatDate } from '@/lib/format-date';
import { manilaToday } from '@/lib/dates';

const MUTED = 'text-stone-500 dark:text-stone-400';
const LABEL = 'block text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5';
const INPUT = 'w-full px-3 py-2 text-sm text-stone-800 dark:text-stone-100 bg-stone-50/80 dark:bg-white/5 border border-stone-200 dark:border-white/10 rounded-lg placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400';

async function send<T>(url: string, method: string, body?: unknown): Promise<T | null> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast.error(data.details?.[0] ?? data.error ?? 'Could not save that');
    return null;
  }
  return data as T;
}

/**
 * The Philippine mark's international registrations (Madrid, outbound): each
 * with its designated countries, its renewal with WIPO, and while it is in
 * its first five years, its dependence on this mark.
 */
export function InternationalRegistrationsCard({ tm }: { tm: Trademark }) {
  // The mark carries its IRs already; their designations are fetched only when it has one.
  const hasRegistrations = tm.internationalRegistrations.length > 0;
  const [regs, setRegs] = useState<RegistrationWithDesignations[] | null>(hasRegistrations ? null : []);
  const [extending, setExtending] = useState(false);
  const [designating, setDesignating] = useState<string | null>(null);
  const canExtend = tm.status !== 'Abandoned' && !!tm.filingDate;

  useEffect(() => {
    if (!hasRegistrations) return;
    fetch(`/api/trademark/${tm.id}/international-registrations`)
      .then((r) => r.json())
      .then((d) => setRegs(d.registrations ?? []))
      .catch(() => setRegs([]));
  }, [tm.id, hasRegistrations]);

  async function patch(irId: string, field: string, value: string | null): Promise<boolean> {
    const d = await send<{ registrations: RegistrationWithDesignations[] }>(`/api/international-registrations/${irId}`, 'PATCH', { [field]: value });
    if (d) setRegs(d.registrations);
    return !!d;
  }

  if (regs && !regs.length && !canExtend) return null;
  const today = manilaToday();

  return (
    <SubjectCard
      title="Abroad (Madrid)"
      icon={<Globe2 className="w-4 h-4" />}
      action={canExtend ? (
        <button type="button" onClick={() => setExtending(true)} className={`${BTN_OUTLINE} h-8 px-2.5 inline-flex items-center gap-1.5 text-xs`}>
          <Plus className="w-3.5 h-3.5" /> Extend abroad
        </button>
      ) : undefined}
    >
      {regs === null ? (
        <p className={`text-sm ${MUTED}`}><Loader2 className="inline w-3.5 h-3.5 animate-spin mr-1" /> Loading…</p>
      ) : !regs.length ? (
        <p className={`text-sm ${MUTED}`}>Not extended abroad. An international application through IPOPHL can designate any Madrid member, resting on this mark.</p>
      ) : (
        <div className="space-y-5">
          {regs.map((ir) => {
            const dependsUntil = dependencyEnds(ir);
            const dependent = !!dependsUntil && today < dependsUntil && !ir.ceasedDate;
            const renewal = irRenewalPeriod(ir);
            const transform = transformationDeadline(ir);
            return (
              <div key={ir.id} className="space-y-2">
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs items-baseline">
                  <span className={MUTED}>IR no.</span>
                  <InlineText value={ir.irNo ?? ''} placeholder="Add once WIPO registers it" mono ariaLabel="International registration number"
                    className="text-[12px] text-stone-800 dark:text-stone-100" onSave={(v) => patch(ir.id, 'irNo', v || null)} />
                  <span className={MUTED}>Filed with IPOPHL</span>
                  <span><EditableDate value={ir.applicationFiledDate} onChange={(v) => patch(ir.id, 'applicationFiledDate', v)} /></span>
                  <span className={MUTED}>International registration</span>
                  <span><EditableDate value={ir.irDate} onChange={(v) => patch(ir.id, 'irDate', v)} /></span>
                  {renewal && (
                    <>
                      <span className={MUTED}>Renewal with WIPO</span>
                      <span className="inline-flex items-center gap-2">
                        {ir.renewalFilingDate
                          ? <>Renewed <EditableDate value={ir.renewalFilingDate} onChange={(v) => patch(ir.id, 'renewalFilingDate', v)} /></>
                          : <><DueChip due={renewal.due} /><EditableDate value={null} placeholder="Record renewal" onChange={(v) => patch(ir.id, 'renewalFilingDate', v)} /></>}
                      </span>
                    </>
                  )}
                  <span className={MUTED}>Ceased</span>
                  <span><EditableDate value={ir.ceasedDate} placeholder="Only if the basic mark fell" onChange={(v) => patch(ir.id, 'ceasedDate', v)} /></span>
                </div>

                {dependent && (
                  <p className={`text-xs ${tm.status === 'Abandoned' ? 'text-rose-700 dark:text-rose-300' : MUTED} inline-flex items-start gap-1.5`}>
                    {tm.status === 'Abandoned' && <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />}
                    {tm.status === 'Abandoned'
                      ? `This mark fell while the international registration still depends on it (until ${formatDate(dependsUntil!)}): the registration falls with it in every country. Record the date it ceased once IPOPHL notifies WIPO.`
                      : `Depends on this mark until ${formatDate(dependsUntil!)}: if this mark is refused, cancelled or lapses before then, every designation falls with it.`}
                  </p>
                )}
                {transform && (
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    Ceased {formatDate(ir.ceasedDate!)}. Each designation can be transformed into a national application, keeping its date, until {formatDate(transform)}.
                  </p>
                )}

                <ul className="divide-y divide-stone-100 dark:divide-white/[0.06] rounded-lg ring-1 ring-inset ring-stone-200/70 dark:ring-white/10">
                  {ir.designations.map((d) => {
                    const next = upcomingDeadlines(d)[0];
                    return (
                      <li key={d.id}>
                        <Link href={`/dashboard/trademarks/${d.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-stone-50 dark:hover:bg-white/[0.03]">
                          <span className="w-8 font-mono text-[11px] text-stone-500 dark:text-stone-400">{d.country}</span>
                          <span className="flex-1 min-w-0 truncate text-stone-800 dark:text-stone-100">{countryName(d.country)}</span>
                          <TrademarkStatusPill status={d.status} size="sm" />
                          <span className="w-44 hidden sm:flex justify-end">
                            {next ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-stone-600 dark:text-stone-300">
                                <span className="truncate max-w-24">{next.title ?? deadlineLabel(next.label, next.officeAction)}</span>
                                <DueChip due={next.due} showDate={false} />
                              </span>
                            ) : <span className={`text-[11px] ${MUTED}`}>—</span>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {!ir.ceasedDate && ir.irDate && (
                  <button type="button" onClick={() => setDesignating(ir.id)} className={`text-xs text-navy-700 dark:text-navy-300 hover:underline`}>
                    Designate more countries
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {extending && (
        <CountriesModal
          title="Extend abroad"
          description="The international application through IPOPHL, and the countries it designates"
          url={`/api/trademark/${tm.id}/international-registrations`}
          minDate={tm.filingDate}
          initial
          onClose={() => setExtending(false)}
          onSaved={(r) => { setRegs(r); setExtending(false); }}
        />
      )}
      {designating && (
        <CountriesModal
          title="Designate more countries"
          description="A subsequent designation: each country’s time to refuse counts from its date"
          url={`/api/international-registrations/${designating}/designations`}
          minDate={regs?.find((r) => r.id === designating)?.irDate ?? null}
          already={regs?.find((r) => r.id === designating)?.designations.map((d) => d.country) ?? []}
          onClose={() => setDesignating(null)}
          onSaved={(r) => { setRegs(r); setDesignating(null); }}
        />
      )}
    </SubjectCard>
  );
}

/** Choosing the countries to designate, with the international application's dates on the first one. */
function CountriesModal({
  title, description, url, minDate, initial = false, already = [], onClose, onSaved,
}: {
  title: string;
  description: string;
  url: string;
  minDate: string | null;
  initial?: boolean;
  already?: string[];
  onClose: () => void;
  onSaved: (registrations: RegistrationWithDesignations[]) => void;
}) {
  const [countries, setCountries] = useState('');
  const [filed, setFiled] = useState<string | null>(null);
  const [irNo, setIrNo] = useState('');
  const [irDate, setIrDate] = useState<string | null>(null);
  const [designated, setDesignated] = useState<string | null>(null);
  const [months, setMonths] = useState<12 | 18>(12);
  const [busy, setBusy] = useState(false);

  const { codes, unknown } = parseCountries(countries);
  const repeated = codes.filter((c) => already.includes(c));
  const problem = unknown.length ? `Not a country or regional office: ${unknown.join(', ')}`
    : repeated.length ? `Already designated: ${repeated.join(', ')}`
    : !initial && !designated ? 'Give the date of the designation.'
    : [filed, irDate, designated].some((d) => d && minDate && d < minDate) ? 'A date is before the one it follows.'
    : null;

  async function save() {
    setBusy(true);
    const body = initial
      ? { countries: codes, applicationFiledDate: filed ?? undefined, irNo: irNo.trim() || undefined, irDate: irDate ?? undefined, refusalPeriodMonths: months }
      : { countries: codes, designationDate: designated, refusalPeriodMonths: months };
    const d = await send<{ registrations: RegistrationWithDesignations[] }>(url, 'POST', body);
    setBusy(false);
    if (d) {
      toast.success(`${codes.length} ${codes.length === 1 ? 'country' : 'countries'} designated`);
      onSaved(d.registrations);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title={title}
      description={description}
      icon={<Globe2 className="w-4 h-4" />}
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !codes.length || !!problem}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Designate
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div>
          <label className={LABEL} htmlFor="madrid-countries">Countries</label>
          <input id="madrid-countries" type="text" value={countries} onChange={(e) => setCountries(e.target.value)}
            placeholder="US, JP, EM, SG" className={INPUT} />
          <p className={`text-[11px] mt-1 ${MUTED}`}>
            {codes.length ? codes.map(countryName).join(' · ') : 'Two-letter codes; EM for the European Union, BX for Benelux, OA for OAPI.'}
          </p>
        </div>
        {initial ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Filed with IPOPHL</label>
                <DatePickerInput value={filed} onChange={setFiled} />
              </div>
              <div>
                <label className={LABEL} htmlFor="madrid-ir-no">IR no.</label>
                <input id="madrid-ir-no" type="text" value={irNo} onChange={(e) => setIrNo(e.target.value)} placeholder="Once WIPO registers it" className={INPUT} />
              </div>
            </div>
            <div>
              <label className={LABEL}>International registration date</label>
              <DatePickerInput value={irDate} onChange={setIrDate} />
              <p className={`text-[11px] mt-1 ${MUTED}`}>Leave it for later if WIPO hasn’t registered it yet. Each country’s time to refuse counts from it.</p>
            </div>
          </>
        ) : (
          <div>
            <label className={LABEL}>Date of the designation</label>
            <DatePickerInput value={designated} onChange={setDesignated} />
          </div>
        )}
        <div>
          <label className={LABEL}>Time each office has to refuse</label>
          <div className="inline-flex rounded-lg border border-stone-200 dark:border-white/10 overflow-hidden text-xs">
            {([12, 18] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMonths(m)}
                className={`px-3 py-1.5 cursor-pointer ${months === m ? 'bg-stone-800 text-white dark:bg-white/15' : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5'}`}>
                {m} months
              </button>
            ))}
          </div>
          <p className={`text-[11px] mt-1 ${MUTED}`}>12 months, or 18 where the country declared the longer period. Each country can be changed on its own page.</p>
        </div>
        {problem && codes.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{problem}</p>}
      </div>
    </Modal>
  );
}

/**
 * A designated country's own filings — a use declaration, a local renewal —
 * due on dates entered by hand, since no rule for each country is kept here.
 */
export function LocalFilingsCard({ tm, onUpdated }: { tm: Trademark; onUpdated: (t: Trademark) => void }) {
  const [label, setLabel] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    const d = await send<{ trademark: Trademark | null }>(url, method, body);
    if (d?.trademark) onUpdated(d.trademark);
    return !!d;
  }

  async function add() {
    if (!label.trim() || !due) return;
    setAdding(true);
    const ok = await call(`/api/trademark/${tm.id}/local-deadlines`, 'POST', { label: label.trim(), dueDate: due });
    setAdding(false);
    if (ok) { setLabel(''); setDue(null); }
  }

  return (
    <SubjectCard title={`Filings in ${countryName(tm.country)}`} icon={<Globe2 className="w-4 h-4" />}>
      {tm.localDeadlines.length === 0 ? (
        <p className={`text-sm ${MUTED}`}>None on record. Add what this country requires — a use declaration, a renewal — with its due date.</p>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
          {tm.localDeadlines.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="flex-1 min-w-0">
                <InlineText value={d.label} ariaLabel="What is due" onSave={(v) => (v ? call(`/api/trademark/${tm.id}/local-deadlines/${d.id}`, 'PATCH', { label: v }) : Promise.resolve(false))} />
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs">
                {!d.filedDate && <DueChip due={d.dueDate} showDate={false} />}
                <EditableDate value={d.dueDate} onChange={(v) => (v ? call(`/api/trademark/${tm.id}/local-deadlines/${d.id}`, 'PATCH', { dueDate: v }) : Promise.resolve(false))} />
              </span>
              <span className="text-xs">
                <EditableDate value={d.filedDate} placeholder="Record filing"
                  onChange={(v) => call(`/api/trademark/${tm.id}/local-deadlines/${d.id}`, 'PATCH', { filedDate: v })} />
              </span>
              <button type="button" title="Remove" aria-label={`Remove ${d.label}`}
                onClick={() => void call(`/api/trademark/${tm.id}/local-deadlines/${d.id}`, 'DELETE')}
                className={`${BTN_GHOST_DANGER} w-7 h-7`}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-48">
          <label className={LABEL} htmlFor="local-deadline-label">Add a filing</label>
          <input id="local-deadline-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Declaration of use (6th year)" className={INPUT} />
        </div>
        <div className="w-44">
          <DatePickerInput value={due} onChange={setDue} />
        </div>
        <Button onClick={() => void add()} disabled={adding || !label.trim() || !due}>
          {adding && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add
        </Button>
      </div>
    </SubjectCard>
  );
}

/** Where a designation abroad comes from, and while it lasts, what it depends on. */
export function AbroadBanner({ tm }: { tm: Trademark }) {
  const ir = tm.parentRegistration;
  if (!ir) return null;
  const today = manilaToday();
  const dependsUntil = dependencyEnds(ir);
  const base = ir.baseMark;
  const fell = !!ir.ceasedDate;
  const atRisk = !fell && base?.status === 'Abandoned' && !!dependsUntil && today < dependsUntil;
  return (
    <div className={`rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${fell || atRisk
      ? 'bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/20'
      : 'bg-stone-50 text-stone-700 ring-stone-200 dark:bg-white/[0.03] dark:text-stone-300 dark:ring-white/10'}`}>
      {countryName(tm.country)}, designated in international registration {ir.irNo ?? '(number to follow)'}
      {base && <> resting on <Link href={`/dashboard/trademarks/${base.id}`} className="font-medium underline underline-offset-2">{base.mark}</Link> in the Philippines</>}.
      {fell
        ? ` It ceased ${formatDate(ir.ceasedDate!)} with the basic mark; this designation can be transformed into a national application until ${formatDate(transformationDeadline(ir)!)}.`
        : atRisk
          ? ` The basic mark has fallen while this depends on it (until ${formatDate(dependsUntil!)}) — the designation falls with it.`
          : dependsUntil && today < dependsUntil
            ? ` Depends on the basic mark until ${formatDate(dependsUntil)}.`
            : ''}
    </div>
  );
}

