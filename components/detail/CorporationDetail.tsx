'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { groupPeople } from '@/lib/corporation-identity';
import CellDropdown from '@/components/admin/CellDropdown';
import { ChevronDown, Loader2, Trash2 } from 'lucide-react';
import { CalendarClock, History, Landmark, LayoutDashboard, Paperclip, ScrollText, Users } from 'lucide-react';
import type {
  Corporation,
  CorporationPerson,
  CorporationFile,
  CorporationMeeting,
  Resolution,
  ResolutionTemplate,
} from '@/types/corporations';
import type { CorporationActivityEntry, CorporationTeamMember } from '@/lib/queries/corporations';
import { buildCorporationStatus, manilaToday } from '@/lib/corporations/status';
import { focusField } from '@/lib/focus-field';
import type { FilingCalendarEntry } from '@/lib/corporations/obligations';
import { MANUAL_STATUSES, hasDerivedStatus } from '@/lib/corporation-lifecycle';
import { toast } from 'sonner';
import { StatusPill as SharedStatusPill } from '@/components/ui/primitives';
import { confirmAction } from '@/components/ui/confirm';
import type { PillTone } from '@/components/ui/tone';
import MarkRegisteredModal from './MarkRegisteredModal';
import ExtractedFieldsModal from './ExtractedFieldsModal';
import CorporationNextSteps from './CorporationNextSteps';
import { uploadCorporationFile } from '@/lib/corporations/upload-file';
import type { StageItem } from '@/lib/corporations/stages';
import type { DocumentExtraction } from '@/lib/ai/corporation-doc-extract-shape';
import DeleteCorporationModal from './DeleteCorporationModal';
import CorporationActivityTab from './CorporationActivityTab';
import CorporationIntakeTab from './CorporationIntakeTab';
import CorporationOverviewTab from './CorporationOverviewTab';
import CorporationRegistrationsTab from './CorporationRegistrationsTab';
import CorporationMeetingsTab from './CorporationMeetingsTab';
import CorporationResolutionsTab from './CorporationResolutionsTab';
import CorporationSecCertsTab from './CorporationSecCertsTab';
import CorporationComplianceTab from './CorporationComplianceTab';
import CorporationPeopleTab from './CorporationPeopleTab';
import CorporationDocumentsTab from './CorporationDocumentsTab';
import CapitalStructureEditor from './CapitalStructureEditor';
import CorporationHeader from './corporation/CorporationHeader';
import PortalSwitch from './corporation/PortalSwitch';
import TrackCards from './corporation/TrackCards';
import LifecycleStepper from './corporation/LifecycleStepper';
import CorporationOverview from './corporation/CorporationOverview';
import BoardPapersTab from './corporation/BoardPapersTab';
import SubjectCrumbs from './SubjectCrumbs';
import CompanyDeliverables from './corporation/CompanyDeliverables';
import CompanyTasks from './corporation/CompanyTasks';
import CompanyClientReports, {
  CompanyReportModal,
  CompanyReportsOwedCard,
  useCompanyReports,
  type Reportable,
} from './corporation/CompanyClientReports';
import { companyName } from '@/lib/corporations/obligations';
import { Building2 } from 'lucide-react';

interface Props {
  corporation: Corporation;
  people: CorporationPerson[];
  files: CorporationFile[];
  meetings: CorporationMeeting[];
  resolutions: Resolution[];
  templates: ResolutionTemplate[];
  deliverables: Array<Record<string, unknown>>;
  matterNames: Record<string, string>;
  clientNames: Record<string, string>;
  activity: CorporationActivityEntry[];
  role: string;
  /** `?tab=` from the URL; ignored unless it names a tab. */
  initialTab?: string;
  calendar: FilingCalendarEntry[];
  openRequestMatterIds: string[];
  team: CorporationTeamMember[];
}

const STATUS_TONE: Record<string, PillTone> = {
  'Pre-Incorporation': 'neutral',
  'In SEC': 'amber',
  Registered: 'blue',
  Active: 'emerald',
  Dissolved: 'muted',
};

const MARK_REGISTERED = '__mark_registered__';

/**
 * The company's lifecycle status, and the way it changes. The pill shows the
 * new status at once and puts the old one back if the save fails; dissolving
 * asks first.
 */
function StatusPill({ corporation, onUpdated }: { corporation: Corporation; onUpdated: (c: Corporation) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [markOpen, setMarkOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const shown = pending ?? corporation.status;

  // Registered / Active are computed from the registration record. Once a corp
  // has a registration on file the only honest move left is dissolution —
  // offering Pre-Incorporation or In SEC would just be overridden by
  // trg_corporations_derive_status on the way in.
  const derived = hasDerivedStatus(corporation);
  const options = derived
    ? [{ id: 'Dissolved', label: 'Dissolved' }]
    : [
        ...MANUAL_STATUSES.filter((s) => s !== corporation.status).map((s) => ({ id: s, label: s })),
        { id: MARK_REGISTERED, label: 'Record SEC registration…', sublabel: 'Marks it Registered' },
      ];

  async function save(status: string | null) {
    setOpen(false);
    if (!status) return;
    if (status === MARK_REGISTERED) {
      setMarkOpen(true);
      return;
    }
    if (status === corporation.status) return;
    if (
      status === 'Dissolved' &&
      !(await confirmAction({
        title: 'Mark this company dissolved?',
        message: 'Its filings and meetings stop being tracked.',
        confirmLabel: 'Mark dissolved',
        danger: true,
      }))
    )
      return;
    setPending(status);
    try {
      const res = await fetch(`/api/corporation/${corporation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.corporation) throw new Error(data?.error || 'Could not change the status');
      onUpdated(data.corporation as Corporation);
      toast.success(`Status set to ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change the status');
    } finally {
      setPending(null);
    }
  }

  return (
    <span className="relative inline-flex items-center gap-1">
      <SharedStatusPill
        buttonRef={anchorRef}
        label={shown}
        tone={STATUS_TONE[shown] ?? 'neutral'}
        hint={derived ? 'Derived from the registration record' : 'Change status'}
        onClick={() => setOpen((o) => !o)}
        disabled={!!pending}
        trailing={pending ? <Loader2 className="w-3 h-3 animate-spin opacity-70" /> : <ChevronDown className="w-3 h-3 opacity-60" />}
      />
      {open && (
        <CellDropdown
          mode="single"
          value={corporation.status}
          options={options}
          onSelect={save}
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
        />
      )}
      <MarkRegisteredModal
        open={markOpen}
        corporation={corporation}
        onClose={() => setMarkOpen(false)}
        onUpdated={onUpdated}
      />
    </span>
  );
}

type TabKey = 'overview' | 'people' | 'registrations' | 'board-papers' | 'compliance' | 'documents' | 'activity';

const TAB_LIST: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'overview',      label: 'Overview',        icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
  { key: 'people',        label: 'People & shares', icon: <Users className="w-3.5 h-3.5" /> },
  { key: 'registrations', label: 'Registrations',   icon: <Landmark className="w-3.5 h-3.5" /> },
  { key: 'board-papers',  label: 'Board papers',    icon: <CalendarClock className="w-3.5 h-3.5" /> },
  { key: 'compliance',    label: 'Compliance',      icon: <ScrollText className="w-3.5 h-3.5" /> },
  { key: 'documents',     label: 'Documents',       icon: <Paperclip className="w-3.5 h-3.5" /> },
  { key: 'activity',      label: 'Activity',        icon: <History className="w-3.5 h-3.5" /> },
];

/** Tabs that were folded into others keep their links working. */
const LEGACY_TAB: Record<string, { tab: TabKey; section?: 'meetings' | 'resolutions' | 'certificates' }> = {
  intake: { tab: 'overview' },
  meetings: { tab: 'board-papers', section: 'meetings' },
  resolutions: { tab: 'board-papers', section: 'resolutions' },
  'sec-certs': { tab: 'board-papers', section: 'certificates' },
};

export default function CorporationDetail(props: Props) {
  const [corporation, setCorporation] = useState(props.corporation);
  useEffect(() => setCorporation(props.corporation), [props.corporation]);
  const [people, setPeople] = useState(props.people);
  useEffect(() => setPeople(props.people), [props.people]);
  const [files, setFiles] = useState(props.files);
  useEffect(() => setFiles(props.files), [props.files]);
  // Meetings / resolutions / compliance deliverables live here (not inside
  // their tabs): tabs unmount on switch, so tab-local copies would reset to
  // the original server props and "lose" anything created since page load.
  const [meetings, setMeetings] = useState(props.meetings);
  useEffect(() => setMeetings(props.meetings), [props.meetings]);
  const [resolutions, setResolutions] = useState(props.resolutions);
  useEffect(() => setResolutions(props.resolutions), [props.resolutions]);
  const [deliverables, setDeliverables] = useState(props.deliverables);
  useEffect(() => setDeliverables(props.deliverables), [props.deliverables]);

  // The open tab lives in `?tab=` so a reload, a shared link, or Back lands on
  // the same tab. Written with history.replaceState, not the router, so
  // switching tabs never re-fetches the page.
  const legacy = props.initialTab ? LEGACY_TAB[props.initialTab] : undefined;
  const [tab, setTabState] = useState<TabKey>(
    legacy?.tab ?? TAB_LIST.find((t) => t.key === props.initialTab)?.key ?? 'overview',
  );
  const tabsRef = useRef<HTMLElement>(null);

  function setTab(next: TabKey, opts: { scroll?: boolean } = {}) {
    setTabState(next);
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
    if (opts.scroll) tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const { resolutionEntries, secCerts } = useMemo(() => {
    const all = resolutions ?? [];
    return {
      resolutionEntries: all.filter((r) => r.kind !== 'Secretarys Certificate'),
      secCerts: all.filter((r) => r.kind === 'Secretarys Certificate'),
    };
  }, [resolutions]);

  const today = useMemo(() => manilaToday(), []);
  const status = useMemo(
    () =>
      buildCorporationStatus({
        corporation,
        files,
        people,
        meetings,
        calendar: props.calendar,
        openRequestMatterIds: props.openRequestMatterIds,
        today,
        deliverables: deliverables.map((d) => ({
          notionId: d.notion_id as string,
          type: (d.type as string) ?? '',
          name: (d.name as string) ?? '',
          externalDueDate: (d.external_due_date as string | null) ?? null,
          status: (d.status as string) ?? '',
        })),
      }),
    [corporation, files, people, meetings, deliverables, props.calendar, props.openRequestMatterIds, today],
  );

  const tabCounts: Partial<Record<TabKey, number>> = {
    people: groupPeople(people.filter((p) => p.isCurrent)).length,
    'board-papers': meetings.length + resolutions.length,
    compliance: status.tracks.find((t) => t.key === 'compliance')?.items.filter((i) => i.state === 'overdue').length || undefined,
    documents: files.length,
  };

  const displayName = corporation.approvedName ?? corporation.proposedNames[0] ?? '(unnamed corporation)';
  const registered = !!corporation.secRegistrationDate;
  const clientId = corporation.engagingClientId ?? corporation.clientId;

  // Mirrors the DELETE route's own gate — the route is the enforcement, this
  // just keeps the button off screens where it would only 403.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canDelete = props.role === 'partner' || props.role === 'super_user';

  // Next-steps flow: a checklist upload runs the same extractor as the
  // Documents tab, so the certificate fills in its own fields.
  const [markRegisteredOpen, setMarkRegisteredOpen] = useState(false);
  const reports = useCompanyReports(corporation.id, corporation);
  const [reporting, setReporting] = useState<Reportable | null>(null);
  const [stepExtraction, setStepExtraction] = useState<{
    extraction: DocumentExtraction;
    reason?: string;
  } | null>(null);

  async function uploadForStep(item: StageItem, file: File) {
    if (item.action.kind !== 'upload') return;
    try {
      const data = await uploadCorporationFile(corporation.id, item.action.category, file);
      setFiles((prev) => [data.file, ...prev]);

      const reg = data.registration;
      if (!reg) return;
      if (reg.result === 'applied' && reg.corporation) {
        setCorporation(reg.corporation as Corporation);
        toast.success('Registration recorded from the certificate.');
      } else if (reg.extraction) {
        // The five post-incorporation documents always confirm; a SEC COR only
        // lands here when the reading needed a human.
        if (reg.extraction.category === 'SEC COR') setMarkRegisteredOpen(true);
        else setStepExtraction({ extraction: reg.extraction, reason: reg.reason });
      } else if (reg.reason) {
        toast.error(reg.reason);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    }
  }

  const nextSteps = (
    <CorporationNextSteps
      corporation={corporation}
      files={files}
      people={people}
      hideWhenComplete={registered}
      onUpload={uploadForStep}
      onGoToTab={(t, field) => {
        setTab(t, { scroll: !field });
        if (field) focusField(field);
      }}
      onRecordRegistration={() => setMarkRegisteredOpen(true)}
    />
  );

  const workCards = (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      <div className="space-y-4">
        <CompanyTasks corporationId={corporation.id} version={corporation} />
        <CompanyDeliverables corporationId={corporation.id} companyName={companyName(corporation)} version={corporation} />
      </div>
      <CompanyClientReports reports={reports} onPrepare={setReporting} />
    </div>
  );

  return (
    <div className="space-y-4">
      <SubjectCrumbs
        list={{ label: 'Corporations', href: '/dashboard/corporations', icon: <Building2 className="w-3.5 h-3.5" /> }}
        client={clientId && props.clientNames[clientId] ? { id: clientId, name: props.clientNames[clientId] } : null}
        current={displayName}
      />
      <CorporationHeader
        corporation={corporation}
        displayName={displayName}
        statusPill={<StatusPill corporation={corporation} onUpdated={setCorporation} />}
        clientName={clientId ? props.clientNames[clientId] ?? null : null}
        team={props.team}
        actions={
          <>
            <PortalSwitch
              endpoint={`/api/corporation/${corporation.id}`}
              visible={corporation.portalVisible}
              noun="company"
              onSaved={(d) => d.corporation && setCorporation(d.corporation as typeof corporation)}
            />
            {canDelete && (
              <button
                onClick={() => setDeleteOpen(true)}
                className="press shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-300 dark:hover:bg-rose-500/10 transition-colors"
                title="Delete this corporation"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </>
        }
      />

      <div className="space-y-2 sm:space-y-3">
        <LifecycleStepper corporation={corporation} status={status} onOpen={(t) => setTab(t, { scroll: true })} />
        <TrackCards status={status} activeTab={tab} onOpen={(t) => setTab(t, { scroll: true })} />
      </div>

      {!reports.loading && reports.owed.length > 0 && <CompanyReportsOwedCard owed={reports.owed} onPrepare={setReporting} />}

      {reporting && (
        <CompanyReportModal
          corporationId={corporation.id}
          report={reporting}
          onClose={() => setReporting(null)}
          onSent={reports.load}
          onFileAdded={(f) => setFiles((prev) => [f, ...prev])}
        />
      )}

      <MarkRegisteredModal
        open={markRegisteredOpen}
        corporation={corporation}
        onClose={() => setMarkRegisteredOpen(false)}
        onUpdated={setCorporation}
      />

      {stepExtraction && (
        <ExtractedFieldsModal
          open
          corporation={corporation}
          extraction={stepExtraction.extraction}
          reason={stepExtraction.reason}
          onClose={() => setStepExtraction(null)}
          onUpdated={setCorporation}
        />
      )}

      {canDelete && (
        <DeleteCorporationModal
          open={deleteOpen}
          corporation={corporation}
          counts={{
            people: groupPeople(people).length,
            files: files.length,
            meetings: meetings.length,
            resolutions: resolutions.length,
          }}
          matterNames={props.matterNames}
          clientNames={props.clientNames}
          onClose={() => setDeleteOpen(false)}
        />
      )}

      <nav
        ref={tabsRef}
        className="sticky top-0 z-20 scroll-mt-3 rounded-2xl border border-stone-200 dark:border-white/10 bg-white/90 dark:bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-white/75 dark:supports-[backdrop-filter]:bg-card/75 px-2 flex gap-1 overflow-x-auto scrollbar-hide"
      >
        {TAB_LIST.map((t) => {
          const count = tabCounts[t.key];
          const active = tab === t.key;
          const alarm = t.key === 'compliance' && !!count;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              aria-current={active ? 'page' : undefined}
              className={`relative shrink-0 inline-flex items-center gap-1.5 px-3 py-3 text-[13px] font-medium transition-colors ${
                active
                  ? 'text-navy-800 dark:text-navy-200'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100'
              }`}
            >
              {t.icon}
              {t.label}
              {count !== undefined && count > 0 && (
                <span
                  className={`min-w-[18px] px-1 py-px rounded-full text-[10px] tabular-nums text-center ${
                    alarm
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                      : active
                        ? 'bg-navy-100 text-navy-700 dark:bg-navy-500/20 dark:text-navy-200'
                        : 'bg-stone-100 text-stone-500 dark:bg-white/10 dark:text-stone-400'
                  }`}
                  title={alarm ? `${count} overdue` : undefined}
                >
                  {count}
                </span>
              )}
              <span
                className={`absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-navy-600 dark:bg-navy-300 transition-transform duration-300 ease-out ${
                  active ? 'scale-x-100' : 'scale-x-0'
                }`}
              />
            </button>
          );
        })}
      </nav>

      <div key={tab} className="reveal">
        {tab === 'overview' &&
          (registered ? (
            <div className="space-y-6">
              <CorporationOverview
                corporation={corporation}
                status={status}
                today={today}
                activity={props.activity}
                retainerName={corporation.retainerMatterId ? props.matterNames[corporation.retainerMatterId] ?? null : null}
                onOpen={(t) => setTab(t, { scroll: true })}
                setupChecklist={nextSteps}
              />
              {workCards}
              <div id="company-details" className="scroll-mt-20">
                <SectionHeading title="Company details" hint="Identity, SEC registration, filing details and the matters that cover the company." />
                <CorporationOverviewTab corporation={corporation} matterNames={props.matterNames} clientNames={props.clientNames} onUpdated={setCorporation} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {nextSteps}
              {workCards}
              <CorporationIntakeTab corporation={corporation} people={people} files={files} onCorporationChange={setCorporation} onPeopleChange={setPeople} onFilesChange={setFiles} />
              <CorporationOverviewTab only="sec" corporation={corporation} matterNames={props.matterNames} clientNames={props.clientNames} onUpdated={setCorporation} />
            </div>
          ))}
        {tab === 'people' && (
          <div className="space-y-4">
            <CorporationPeopleTab corporation={corporation} people={people} files={files} onPeopleChange={setPeople} onFilesChange={setFiles} />
            <CapitalStructureEditor corporation={corporation} people={people} />
          </div>
        )}
        {tab === 'registrations' && <CorporationRegistrationsTab corporation={corporation} files={files} onFilesChange={setFiles} onCorporationChange={setCorporation} />}
        {tab === 'board-papers' && (
          <BoardPapersTab
            initial={legacy?.section}
            counts={{ meetings: meetings.length, resolutions: resolutionEntries.length, certificates: secCerts.length }}
            meetings={<CorporationMeetingsTab corporation={corporation} meetings={meetings} onMeetingsChange={setMeetings} resolutions={resolutions} templates={props.templates} />}
            resolutions={
              <CorporationResolutionsTab
                corporation={corporation}
                resolutions={resolutionEntries}
                onResolutionsChange={setResolutions}
                templates={props.templates}
                meetings={meetings}
              />
            }
            certificates={
              <CorporationSecCertsTab
                corporation={corporation}
                secCerts={secCerts}
                onResolutionsChange={setResolutions}
                bundleableResolutions={resolutionEntries}
                templates={props.templates}
                meetings={meetings}
              />
            }
          />
        )}
        {tab === 'compliance' && (
          <CorporationComplianceTab
            corporation={corporation}
            files={files}
            onFilesChange={setFiles}
            deliverables={deliverables}
            onDeliverablesChange={setDeliverables}
            matterNames={props.matterNames}
            people={people}
            meetings={meetings}
            calendar={props.calendar}
            openRequestMatterIds={props.openRequestMatterIds}
          />
        )}
        {tab === 'documents' && (
          <CorporationDocumentsTab corporation={corporation} files={files} onFilesChange={setFiles} onCorporationChange={setCorporation} people={people} />
        )}
        {tab === 'activity' && <CorporationActivityTab activity={props.activity} />}
      </div>
    </div>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-3 px-1">
      <h2 className="font-serif text-lg text-stone-900 dark:text-stone-50">{title}</h2>
      {hint && <p className="text-xs text-stone-500 dark:text-stone-400 truncate">{hint}</p>}
    </div>
  );
}
