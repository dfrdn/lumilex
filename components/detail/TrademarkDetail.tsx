'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowRight, Ban, CalendarClock, Check, ChevronDown, FileStack, FileText, Info, ListChecks, Loader2, Mail,
  NotebookPen, Package, Paperclip, PartyPopper, Pencil, RotateCcw, ScrollText, Stamp, Tag, Trash2, Upload, Users,
} from 'lucide-react';
import type { ExtensionDecision, Trademark, TrademarkFileStep, TrademarkOfficeAction, TrademarkType } from '@/types/notion';
import { isAbroad, isDesignation, isNational, oppositionPeriod, owesFirstPublicationFee, refNo, type DeadlineWindow } from '@/lib/trademark-deadlines';
import { countryName } from '@/lib/trademarks/countries';
import { manilaToday } from '@/lib/dates';
import { formatDate, formatDateShort } from '@/lib/format-date';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { shortDate } from '@/lib/corporations/status';
import { focusField } from '@/lib/focus-field';
import { trademarkNextStep, trademarkSteps, trademarkTracks, upkeepRows, type JourneyTarget, type NextStep } from '@/lib/trademarks/journey';
import { actionForDeadline, deadlineLabel, extensionDecisionAction, extensionDecisionSpecs, type ActionSpec, type TrademarkAction } from '@/lib/trademarks/actions';
import { planUndo } from '@/lib/trademarks/undo';
import { officeActionName, responseName } from '@/lib/trademarks/office-actions';
import { fileStepLabel, stepOptions } from '@/lib/trademarks/file-steps';
import { uploadTrademarkFile, uploadViaSignedUrl } from '@/lib/corporations/upload-file';
import type { SubjectTeamMember } from '@/lib/queries/subject-team';
import CellDropdown from '@/components/admin/CellDropdown';
import {
  TrademarkActionButton, recordedToast, runTrademarkAction, undoTrademarkAction, uploadStepFile, type TrademarkFileEntry,
} from '@/components/trademarks/actions';
import FilePreviewModal from '@/components/FilePreviewModal';
import { TrademarkStatusPill } from '@/components/trademarks/ui';
import SubjectHeader from '@/components/ui/SubjectHeader';
import Stepper from '@/components/ui/Stepper';
import TrackCards from '@/components/ui/TrackCards';
import DatedActionButton from '@/components/ui/DatedActionButton';
import { CopyText, DueChip, Fact, MetaChip, StatusPill, SubjectCard, monogram } from '@/components/ui/primitives';
import { EditableDate, InlineText, NotesField } from '@/components/ui/inline-edit';
import { BTN_GHOST_DANGER, BTN_OUTLINE, BTN_PRIMARY, STATE_CHIP, TONE_TEXT } from '@/components/ui/tone';
import PortalSwitch from './corporation/PortalSwitch';
import MarkMatterLinks from '@/components/trademarks/MarkMatterLinks';
import MarkClientPicker from '@/components/trademarks/MarkClientPicker';
import SubjectCrumbs from './SubjectCrumbs';
import ClientReportModal from '@/components/trademarks/ClientReportModal';
import UploadedReportModal from '@/components/trademarks/UploadedReportModal';
import SentReportModal from '@/components/trademarks/SentReportModal';
import ExtensionRequestModal from '@/components/trademarks/ExtensionRequestModal';
import MarkDeliverablesCard, { StepDeliverable, useMarkDeliverables, type MarkDeliverablesState } from '@/components/trademarks/MarkDeliverables';
import { isDeliverableAction } from '@/lib/trademarks/deliverables';
import { AbroadBanner, InternationalRegistrationsCard, LocalFilingsCard } from '@/components/trademarks/InternationalRegistrations';
import { REPORT_EVENTS, isReportEvent, owedReportEvents, reportEventForAction, reportableEvents, type ReportEvent } from '@/lib/trademarks/client-report';
import { confirmAction } from '@/components/ui/confirm';

interface Props {
  trademark: Trademark;
  markImageUrl: string | null;
  gpoaUrl: string | null;
  team: SubjectTeamMember[];
}

type FileEntry = TrademarkFileEntry;

interface ReportEntry {
  id: number;
  /** A deadline reminder names its deadline; a report on a step names the step. */
  deadlineKind: string | null;
  deadlineDue: string | null;
  event: string | null;
  eventDate: string | null;
  sentAt: string;
  sentByName: string | null;
  recipientEmail: string;
  ccEmails: string[];
  subject: string;
  /** Went out by other means and was only recorded here. */
  sentOutside: boolean;
  /** What a report not on one of the steps is about. */
  title: string | null;
  notes: string | null;
  attachments: { name: string; path: string; url: string | null }[];
  /** The status report deliverable this report is. */
  deliverable: { id: string; name: string } | null;
}

type PatchField = (field: string, value: unknown) => Promise<boolean>;

const TYPES: TrademarkType[] = ['Wordmark', 'Combined', 'Device'];
const MUTED = 'text-stone-500 dark:text-stone-400';
const LINK = 'text-navy-700 dark:text-navy-300 hover:underline underline-offset-2';

/**
 * A mark's page, laid out like a company's: who it is, where it stands in its
 * life (phases and tracks), the one thing to do next, then the record —
 * progress, upkeep, papers — with the facts people look up on the right.
 */
export default function TrademarkDetail({ trademark: initial, markImageUrl: initialMarkUrl, gpoaUrl: initialGpoaUrl, team }: Props) {
  const [tm, setTm] = useState<Trademark>(initial);
  const [markImageUrl, setMarkImageUrl] = useState<string | null>(initialMarkUrl);
  const [gpoaUrl, setGpoaUrl] = useState<string | null>(initialGpoaUrl);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reporting, setReporting] = useState<ReportEvent | null>(null);
  const [viewingReport, setViewingReport] = useState<number | null>(null);
  /** A report on the team's own paper, to send or to record as already sent. */
  const [ownReport, setOwnReport] = useState<{ mode: 'send' | 'record'; event: ReportEvent | null } | null>(null);
  /** A sent report's attachments, opened in the file preview at the one clicked. */
  const [reportFiles, setReportFiles] = useState<{ files: ReportEntry['attachments']; index: number } | null>(null);
  const [draftingExtension, setDraftingExtension] = useState(false);
  const [abandoning, setAbandoning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [gpoaUploading, setGpoaUploading] = useState(false);
  const [viewing, setViewing] = useState<FileEntry[] | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);

  const markFileInput = useRef<HTMLInputElement>(null);
  const gpoaFileInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const stepFileInput = useRef<HTMLInputElement>(null);
  const attachTarget = useRef<{ step: TrademarkFileStep; officeActionId: string | null } | null>(null);

  useEffect(() => {
    fetch(`/api/trademark/${tm.id}/files`)
      .then((r) => r.json())
      .then((d) => setFiles(d.files ?? []))
      .catch(() => {})
      .finally(() => setFilesLoading(false));

    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tm.id]);

  function loadReports() {
    fetch(`/api/trademark/${tm.id}/reports`)
      .then((r) => r.json())
      .then((d) => setReports(d.reports ?? []))
      .catch(() => {})
      .finally(() => setReportsLoading(false));
  }

  const owed = owedReports(tm, reports);
  const work = useMarkDeliverables(tm);

  // ── Mutations ───────────────────────────────────────────────────

  /** Saves one field. Resolves true on success; failures surface as a toast. */
  const patchField: PatchField = async (field, value) => {
    const res = await fetch(`/api/trademark/${tm.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || 'Could not save that change');
      return false;
    }
    if (data.trademark) setTm(data.trademark);
    return true;
  };

  async function uploadMarkImage(file: File) {
    setImageUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/trademark/${tm.id}/mark-image`, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    setImageUploading(false);
    if (!res.ok) {
      toast.error(data.error || 'Upload failed');
      return;
    }
    setTm((prev) => ({ ...prev, markImagePath: data.markImagePath }));
    setMarkImageUrl(data.url);
    toast.success('Mark image saved');
  }

  async function uploadGpoa(file: File) {
    setGpoaUploading(true);
    let data: { gpoaFilePath: string | null; gpoaFiledDate: string | null; url: string | null };
    try {
      data = await uploadViaSignedUrl(`/api/trademark/${tm.id}/gpoa`, file);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
      return;
    } finally {
      setGpoaUploading(false);
    }
    setTm((prev) => ({
      ...prev,
      gpoaFilePath: data.gpoaFilePath,
      gpoaFiledDate: data.gpoaFiledDate,
      gpoaStatus: 'Filed',
    }));
    setGpoaUrl(data.url);
    toast.success('GPOA filed');
  }

  async function uploadFiles(fileList: File[]) {
    setUploading(true);
    let saved = 0;
    try {
      for (const f of fileList) {
        try {
          const data = await uploadTrademarkFile<{ file?: FileEntry }>(tm.id, f);
          if (data.file) {
            setFiles((prev) => [data.file!, ...prev]);
            saved++;
          }
        } catch (e) {
          toast.error(e instanceof Error ? e.message : `Could not upload ${f.name}`);
        }
      }
    } finally {
      setUploading(false);
    }
    if (saved) toast.success(saved === 1 ? 'File uploaded' : `${saved} files uploaded`);
  }

  async function deleteFile(fileId: number) {
    if (!(await confirmAction({ title: 'Remove this file?', confirmLabel: 'Remove', danger: true }))) return;
    const index = files.findIndex((f) => f.id === fileId);
    const removed = files[index];
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    const res = await fetch(`/api/trademark/${tm.id}/files?fileId=${fileId}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      if (removed) setFiles((prev) => [...prev.slice(0, index), removed, ...prev.slice(index)]);
      toast.error('Could not remove the file');
    }
  }

  async function handleAbandon() {
    const ok = await confirmAction({
      title: `Abandon ${tm.mark || 'this trademark'}?`,
      message: 'It stops being prosecuted and its deadlines are no longer tracked.',
      confirmLabel: 'Abandon',
      danger: true,
    });
    if (!ok) return;
    const previousStatus = tm.status;
    setAbandoning(true);
    const result = await runTrademarkAction(tm.id, 'abandon');
    setAbandoning(false);
    if (!result) return;
    setTm(result.trademark);
    recordedToast('Abandoned', { trademarkId: tm.id, action: 'abandon', previousStatus, onUndone: setTm });
  }

  /** A recorded step: take the new row (and the paper that came with it) and say what moved. Action labels read as done ("Fee paid"). */
  function recorded(updated: Trademark, spec: ActionSpec, file: FileEntry | null = null, officeActionId: string | null = null) {
    const previousStatus = tm.status;
    setTm(updated);
    if (file) setFiles((prev) => [file, ...prev]);
    recordedToast(spec.label === 'Mark as filed' ? 'Marked as filed' : spec.label, {
      trademarkId: tm.id,
      action: spec.action,
      previousStatus,
      officeActionId: officeActionId ?? spec.officeActionId,
      onUndone: (t) => {
        setTm(t);
        if (spec.action === 'oa_received' && officeActionId) unlinkRound(officeActionId);
      },
    });
    const event = reportEventForAction(spec.action);
    if (event) {
      toast(`${REPORT_EVENTS[event].label} ready for the client`, {
        action: { label: 'Review & send', onClick: () => setReporting(event) },
      });
    }
  }

  /** A round was taken back: its papers stay, no longer tied to it. */
  function unlinkRound(officeActionId: string) {
    setFiles((prev) => prev.map((f) => (f.officeActionId === officeActionId ? { ...f, officeActionId: null } : f)));
  }

  /** Corrects one field of a recorded Office Action round. */
  async function patchRound(officeActionId: string, field: string, value: string | null): Promise<boolean> {
    const res = await fetch(`/api/trademark/${tm.id}/office-actions/${officeActionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.details?.[0] ?? data.error ?? 'Could not save that change');
      return false;
    }
    setTm(data.trademark);
    return true;
  }

  /** The papers filed under a step (and round). */
  const filesFor = (step: TrademarkFileStep, officeActionId?: string) =>
    files.filter((f) => f.step === step && (officeActionId === undefined || f.officeActionId === officeActionId));

  /** Asks for a file, then files it under the step. */
  function attachTo(step: TrademarkFileStep, officeActionId: string | null = null) {
    attachTarget.current = { step, officeActionId };
    stepFileInput.current?.click();
  }

  async function uploadToStep(file: File) {
    const target = attachTarget.current;
    if (!target) return;
    const key = `${target.step}|${target.officeActionId ?? ''}`;
    setAttaching(key);
    try {
      const saved = await uploadStepFile(tm.id, file, target.step, target.officeActionId);
      setFiles((prev) => [saved, ...prev]);
      toast.success('Document attached');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`);
    } finally {
      setAttaching(null);
    }
  }

  /** Files a paper under a step, or takes it off the timeline. */
  async function tagFile(fileId: number, step: TrademarkFileStep | null, officeActionId: string | null) {
    const index = files.findIndex((f) => f.id === fileId);
    const before = files[index];
    if (!before) return;
    setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, step, officeActionId } : f)));
    const res = await fetch(`/api/trademark/${tm.id}/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step, officeActionId }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setFiles((prev) => prev.map((f) => (f.id === fileId ? before : f)));
      toast.error(data?.error ?? 'Could not file that paper');
    }
  }

  /** Takes back a step recorded some time ago, after saying what that clears. */
  async function undoStep(action: TrademarkAction, label: string, officeActionId?: string) {
    const plan = planUndo(action, tm, null, officeActionId);
    if (!plan.ok) {
      toast.message(plan.error);
      return;
    }
    const filedWork = work.deliverables.find(
      (d) => d.action === action && d.officeActionId === (officeActionId ?? null) && d.status === DELIVERABLE_STATUS.FILED_OR_SENT_OUT,
    );
    const ok = await confirmAction({
      title: action === 'abandon' ? `Restore ${tm.mark || 'this trademark'}?` : `Undo “${label}”?`,
      message: (plan.updates.status
        ? `Its date is cleared and the mark goes back to ${plan.updates.status}.`
        : 'What was recorded for this step is cleared.') + (filedWork ? ` Its deliverable, “${filedWork.name}”, is reopened.` : ''),
      confirmLabel: action === 'abandon' ? 'Restore' : 'Undo',
      ...(action === 'oa_received' ? { message: 'The Office Action is removed; any papers filed under it stay in Files.' } : {}),
    });
    if (!ok) return;
    const updated = await undoTrademarkAction(tm.id, action, undefined, officeActionId);
    if (!updated) return;
    setTm(updated);
    if (action === 'oa_received' && officeActionId) unlinkRound(officeActionId);
    toast.success(action === 'abandon' ? 'Restored' : 'Undone');
  }

  // ── Derived ─────────────────────────────────────────────────────

  const today = manilaToday();
  const step = useMemo(() => trademarkNextStep(tm, today), [tm, today]);
  const steps = useMemo(() => trademarkSteps(tm, today), [tm, today]);
  const tracks = useMemo(() => trademarkTracks(tm, today), [tm, today]);
  const computedRefNo = refNo(tm);
  const isActive = tm.status !== 'Abandoned' && tm.status !== 'Registered';
  const opposition = oppositionPeriod(tm.publishedDate);
  const registered = tm.status === 'Registered' || !!tm.regDate;
  const abroad = isAbroad(tm);
  // Either kind of designation: no national filing steps, and its number is the IR's.
  const madrid = isDesignation(tm) || abroad;
  const showUpkeep = upkeepRows(tm).length > 0 || registered;

  const open = (target: JourneyTarget) => focusField(`tm-${target}`, { focus: false });

  /** What a timeline step needs to show, open and take its papers. */
  const docs = (step: TrademarkFileStep, officeActionId?: string): StepDocs => {
    const list = filesFor(step, officeActionId);
    return {
      files: list,
      onOpenFiles: () => setViewing(list),
      onAttach: () => attachTo(step, officeActionId ?? null),
      attaching: attaching === `${step}|${officeActionId ?? ''}`,
    };
  };

  return (
    <div className="space-y-4">
      <SubjectCrumbs
        list={{ label: 'Trademarks', href: '/dashboard/trademarks', icon: <Stamp className="w-3.5 h-3.5" /> }}
        client={tm.clientId && tm.clientName ? { id: tm.clientId, name: tm.clientName } : null}
        current={tm.mark || '(Untitled)'}
      />

      <SubjectHeader
        badge={
          <>
            <MarkBadge mark={tm.mark} imageUrl={markImageUrl} uploading={imageUploading} onPick={() => markFileInput.current?.click()} />
            <input
              ref={markFileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadMarkImage(f);
                e.target.value = '';
              }}
            />
          </>
        }
        title={
          <div className="min-w-0 max-w-full" style={{ width: `${Math.max(6, (tm.mark || '').length + 3)}ch` }}>
            <InlineText
              value={tm.mark}
              placeholder="Mark name"
              ariaLabel="Mark name"
              onSave={(v) => (v ? patchField('mark', v) : Promise.resolve(false))}
              className="font-serif text-2xl tracking-tight text-stone-900 dark:text-stone-50"
            />
          </div>
        }
        statusPill={<TrademarkStatusPill status={tm.status} />}
        meta={
          <>
            <TypePicker value={tm.type} onChange={(v) => patchField('type', v)} />
            {tm.country && <MetaChip>{tm.country}</MetaChip>}
            {madrid && <MetaChip>{abroad ? 'Madrid designation abroad' : 'Madrid designation'}</MetaChip>}
            {tm.regIrNo && (
              <MetaChip mono>
                {madrid ? 'IR' : registered ? 'Reg.' : 'App.'} <CopyText text={tm.regIrNo} className="ml-1" />
              </MetaChip>
            )}
          </>
        }
        client={tm.clientId && tm.clientName ? { id: tm.clientId, name: tm.clientName } : null}
        team={team}
        below={<ClassesEditor classes={tm.classes} onSave={(v) => patchField('classes', v)} />}
        actions={
          <>
            <PortalSwitch
              endpoint={`/api/trademark/${tm.id}`}
              visible={tm.portalVisible}
              noun="mark"
              onSaved={(d) => d.trademark && setTm(d.trademark as Trademark)}
            />
            {isActive && (
              <button
                type="button"
                onClick={handleAbandon}
                disabled={abandoning}
                className={`${BTN_GHOST_DANGER} w-8 h-8 disabled:opacity-50`}
                title="Abandon — stop prosecuting this mark"
                aria-label="Abandon this mark"
              >
                {abandoning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              </button>
            )}
            {tm.status === 'Abandoned' && (
              <button
                type="button"
                onClick={() => void undoStep('abandon', 'Abandoned')}
                className={`${BTN_OUTLINE} h-8 px-2.5 inline-flex items-center gap-1.5 text-xs`}
                title="Restore — undo the abandonment"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore
              </button>
            )}
          </>
        }
      />

      {abroad && <AbroadBanner tm={tm} />}

      {steps && (
        <Stepper
          steps={steps.map((s) => ({ key: s.key, label: s.label, sub: s.sub, state: s.state, warn: s.warn, onOpen: () => open(s.target) }))}
        />
      )}

      <TrackCards
        onOpen={(key) => open(key as JourneyTarget)}
        cards={tracks.map((t) => ({
          key: t.key,
          label: t.label,
          icon: t.key === 'progress' ? <Stamp className="w-4 h-4" /> : <ScrollText className="w-4 h-4" />,
          health: t.health,
          done: t.done,
          total: t.total,
          summary: t.summary,
          next: t.next,
          stateLabel: t.stateLabel,
        }))}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4 min-w-0">
          {!reportsLoading && owed.length > 0 && <ReportsOwedCard owed={owed} onPrepare={setReporting} />}
          <NextStepCard tm={tm} step={step} work={work} onRecorded={recorded} onPatch={patchField} onDraftExtension={() => setDraftingExtension(true)} />
          {draftingExtension && <ExtensionRequestModal trademark={tm} onClose={() => setDraftingExtension(false)} />}
          <MarkDeliverablesCard state={work} />

          <div data-field="tm-progress" className="rounded-2xl scroll-mt-4">
            <SubjectCard
              title="Progress"
              icon={<ListChecks className="w-4 h-4" />}
              action={<span className={`text-[11px] ${MUTED}`}>Click a date to correct it</span>}
              bodyClassName="px-5 pb-5 pt-2"
            >
              <ol>
                {madrid ? (
                  <ProgressStep
                    done
                    label={abroad ? `${countryName(tm.country)} designated` : 'Philippines designated'}
                    detail={
                      <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs items-baseline">
                        <span className={MUTED}>International registration</span>
                        <span>
                          {abroad
                            ? (tm.irDate ? formatDate(tm.irDate) : <span className={MUTED}>On the basic mark’s page, once WIPO registers it</span>)
                            : <EditableDate value={tm.irDate} onChange={(v) => (v ? patchField('irDate', v) : clearRefused())} />}
                        </span>
                        <span className={MUTED}>Designated later on</span>
                        <span>
                          <EditableDate value={tm.designationDate} onChange={(v) => patchField('designationDate', v)} placeholder="Only if after the IR" />
                        </span>
                      </div>
                    }
                    {...docs('filing')}
                  />
                ) : (
                  <>
                    <ProgressStep
                      done={tm.status !== 'Prelim'}
                      label="Instructions received"
                      onUndo={tm.status === 'For Filing' ? () => undoStep('instructions_received', 'Instructions received') : undefined}
                    />
                    <ProgressStep
                      done={!!tm.filingDate}
                      label="Filed with IPOPHL"
                      date={tm.filingDate}
                      onDate={(v) => (v ? patchField('filingDate', v) : clearRefused())}
                      onUndo={tm.filingDate ? () => undoStep('mark_as_filed', 'Filed with IPOPHL') : undefined}
                      {...docs('filing')}
                    />
                  </>
                )}
                {tm.officeActions.map((oa) => (
                  <OfficeActionSteps
                    key={oa.id}
                    oa={oa}
                    name={officeActionName(tm.officeActions, oa)}
                    onPatch={(field, v) => patchRound(oa.id, field, v)}
                    onUndo={undoStep}
                    docs={docs}
                    onOpen={setViewing}
                    onRecorded={recorded}
                  />
                ))}
                {!madrid && <ProgressStep
                  done={!!tm.noiDate}
                  label="Notice of Allowance"
                  date={tm.noiDate}
                  onDate={(v) => (v ? patchField('noiDate', v) : clearRefused())}
                  onUndo={tm.noiDate ? () => undoStep('noi_received', 'Notice of Allowance') : undefined}
                  detail={tm.noiDate ? <ReceivedLine value={tm.noiReceivedDate} onChange={(v) => patchField('noiReceivedDate', v)} /> : undefined}
                  {...docs('noi')}
                />}
                {!madrid && owesFirstPublicationFee(tm.filingDate) && (
                  <ProgressStep
                    done={!!tm.noiPaymentDate}
                    label="1st publication fee paid"
                    date={tm.noiPaymentDate}
                    onDate={(v) => patchField('noiPaymentDate', v)}
                    onUndo={tm.noiPaymentDate ? () => undoStep('noi_paid', '1st publication fee paid') : undefined}
                    {...docs('noi_payment')}
                  />
                )}
                {!abroad && <ProgressStep
                  done={!!tm.publishedDate}
                  label="Published for opposition"
                  date={tm.publishedDate}
                  onDate={(v) => (v ? patchField('publishedDate', v) : clearRefused())}
                  onUndo={tm.publishedDate ? () => undoStep('published', 'Published for opposition') : undefined}
                  detail={
                    opposition && !tm.oppositionFiledDate && !registered ? (
                      <p className={`text-xs mt-0.5 ${MUTED}`}>
                        Opposition period ends {shortDate(opposition.ends)}; {madrid ? 'IPOPHL grants protection' : 'the Notice of Issuance follows'} if none is filed.
                      </p>
                    ) : undefined
                  }
                  {...docs('publication')}
                />}
                {tm.oppositionFiledDate && (
                  <ProgressStep
                    done
                    tone="warn"
                    label="Opposition filed"
                    date={tm.oppositionFiledDate}
                    onDate={(v) => (v ? patchField('oppositionFiledDate', v) : clearRefused())}
                    onUndo={() => undoStep('opposition_filed', 'Opposition filed')}
                    {...docs('opposition')}
                  />
                )}
                {!madrid && !tm.oppositionFiledDate && (
                  <ProgressStep
                    done={!!tm.issuanceNoticeDate}
                    label="Notice of Issuance"
                    date={tm.issuanceNoticeDate}
                    onDate={(v) => patchField('issuanceNoticeDate', v)}
                    onUndo={tm.issuanceNoticeDate ? () => undoStep('issuance_received', 'Notice of Issuance') : undefined}
                    detail={tm.issuanceNoticeDate ? <ReceivedLine value={tm.issuanceNoticeReceivedDate} onChange={(v) => patchField('issuanceNoticeReceivedDate', v)} /> : undefined}
                    {...docs('issuance')}
                  />
                )}
                {!madrid && <ProgressStep
                  done={!!tm.issuanceFeePaidDate}
                  label="Issuance and 2nd publication fees paid"
                  date={tm.issuanceFeePaidDate}
                  onDate={(v) => patchField('issuanceFeePaidDate', v)}
                  onUndo={tm.issuanceFeePaidDate ? () => undoStep('issuance_paid', 'Issuance fees paid') : undefined}
                  detail={
                    tm.issuanceFeePaidDate && (!tm.issuanceNoticeDate || tm.issuanceFeePaidDate < tm.issuanceNoticeDate) ? (
                      <p className={`text-xs mt-0.5 ${MUTED}`}>Paid in advance, on allowance.</p>
                    ) : undefined
                  }
                  {...docs('issuance_payment')}
                />}
                {tm.abandonmentMailingDate && (
                  <>
                    <ProgressStep
                      done
                      tone="warn"
                      label="Notice of abandonment"
                      date={tm.abandonmentMailingDate}
                      onDate={(v) => (v ? patchField('abandonmentMailingDate', v) : clearRefused())}
                      onUndo={tm.status === 'Abandoned' && !tm.revivalFiledDate && !tm.revivalDeclined ? () => undoStep('abandonment_notice', 'Notice of abandonment') : undefined}
                      detail={<ReceivedLine value={tm.abandonmentReceivedDate} onChange={(v) => patchField('abandonmentReceivedDate', v)} />}
                      {...docs('abandonment')}
                    />
                    <ProgressStep
                      done={!!tm.revivalFiledDate}
                      label={tm.revivalDeclined ? 'Not revived' : 'Revival filed'}
                      date={tm.revivalFiledDate}
                      onDate={(v) => (v ? patchField('revivalFiledDate', v) : clearRefused())}
                      onUndo={
                        tm.revivalFiledDate ? () => undoStep('revival_filed', 'Revival filed')
                          : tm.revivalDeclined ? () => undoStep('revival_declined', 'Not reviving')
                          : undefined
                      }
                      {...docs('revival')}
                    />
                  </>
                )}
                <ProgressStep
                  done={tm.status === 'Registered'}
                  last
                  label={madrid ? 'Protection granted' : 'Registered'}
                  onUndo={tm.status === 'Registered' ? () => undoStep(madrid ? 'protection_granted' : 'cor_received', madrid ? 'Protection granted' : 'Registered') : undefined}
                  {...docs('cor')}
                  detail={
                    tm.status === 'Registered' || tm.regDate || tm.corReportedDate ? (
                      <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs items-baseline">
                        <span className={MUTED}>{madrid ? 'Date of the statement of grant' : 'Registration date'}</span>
                        <span data-field="regDate" className="rounded">
                          <EditableDate value={tm.regDate} onChange={(v) => (v ? patchField('regDate', v) : clearRefused())} />
                        </span>
                        <span className={MUTED}>{madrid ? 'Statement received' : 'COR received'}</span>
                        <span>
                          <EditableDate value={tm.corReportedDate} onChange={(v) => (v ? patchField('corReportedDate', v) : clearRefused())} />
                        </span>
                      </div>
                    ) : undefined
                  }
                />
              </ol>
            </SubjectCard>
          </div>

          {abroad ? (
            <div data-field="tm-upkeep" className="rounded-2xl scroll-mt-4">
              <LocalFilingsCard tm={tm} onUpdated={setTm} />
            </div>
          ) : showUpkeep && (
            <div data-field="tm-upkeep" className="rounded-2xl scroll-mt-4">
              <Obligations tm={tm} onPatch={patchField} onUndo={undoStep} docs={docs} onRecorded={recorded} />
            </div>
          )}

          {isNational(tm) && <InternationalRegistrationsCard tm={tm} />}

          <GoodsServicesCard
            classes={tm.classes}
            value={tm.goodsServices}
            onSave={(next) => patchField('goodsServices', next)}
          />

          <FilesCard
            files={files}
            officeActions={tm.officeActions}
            loading={filesLoading}
            uploading={uploading}
            onPick={() => filesInput.current?.click()}
            onDrop={uploadFiles}
            onDelete={deleteFile}
            onOpen={(f) => setViewing([f])}
            onTag={tagFile}
          />
          <input
            ref={stepFileInput}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadToStep(f);
              e.target.value = '';
            }}
          />
          <FilePreviewModal
            open={viewing !== null}
            onClose={() => setViewing(null)}
            files={(viewing ?? []).map((f) => ({ name: f.name, url: f.url ?? '', path: f.storagePath }))}
          />
          <input
            ref={filesInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const list = e.target.files;
              if (list) void uploadFiles(Array.from(list));
              e.target.value = '';
            }}
          />

          <ReportsCard
            tm={tm}
            reports={reports}
            owed={owed}
            loading={reportsLoading}
            onPrepare={setReporting}
            onOwnReport={(mode) => setOwnReport({ mode, event: null })}
            onView={setViewingReport}
            onOpenFile={(files, index) => setReportFiles({ files, index })}
          />
          <FilePreviewModal
            open={reportFiles !== null}
            onClose={() => setReportFiles(null)}
            files={(reportFiles?.files ?? []).map((f) => ({ name: f.name, url: f.url ?? '', path: f.path }))}
            initialIndex={reportFiles?.index ?? 0}
          />
          {ownReport && (
            <UploadedReportModal
              mode={ownReport.mode}
              trademark={tm}
              steps={reportableEvents(tm)}
              initialEvent={ownReport.event}
              statusReports={work.deliverables.filter((d) => d.kind === 'status_report')}
              onClose={() => setOwnReport(null)}
              onDone={() => {
                loadReports();
                work.reload();
              }}
            />
          )}
          {viewingReport !== null && (
            <SentReportModal trademarkId={tm.id} reportId={viewingReport} onClose={() => setViewingReport(null)} />
          )}
          {reporting && (
            <ClientReportModal
              key={reporting}
              trademarkId={tm.id}
              event={reporting}
              onClose={() => setReporting(null)}
              onFileAdded={(f) => setFiles((prev) => [f, ...prev])}
              onUseOwnPaper={() => {
                setOwnReport({ mode: 'send', event: reporting });
                setReporting(null);
              }}
              onSent={(r) => {
                // Shown at once, then replaced by the stored row with its sender and attachments.
                setReports((prev) => [
                  { ...r, deadlineKind: null, deadlineDue: null, sentByName: null, sentOutside: false, title: null, notes: null, attachments: [], deliverable: null },
                  ...prev,
                ]);
                loadReports();
              }}
            />
          )}
        </div>

        <aside className="space-y-4 min-w-0">
          <SubjectCard title="At a glance" icon={<Info className="w-4 h-4" />}>
            <dl>
              <Fact
                label={madrid ? 'International registration no.' : registered ? 'Registration no.' : 'Application no.'}
                value={
                  <InlineText
                    value={tm.regIrNo ?? ''}
                    placeholder="Add number"
                    ariaLabel={madrid ? 'International registration number' : 'Application or registration number'}
                    mono
                    className="text-[12px] text-right text-stone-800 dark:text-stone-100"
                    onSave={(v) => patchField('regIrNo', v || null)}
                  />
                }
              />
              <Fact label="Ref. no." value={<CopyText text={computedRefNo} className="text-[12px]" />} />
              {madrid ? (
                <>
                  <Fact label="International registration" value={tm.irDate ? shortDate(tm.irDate) : null} />
                  {tm.designationDate && <Fact label="Designated" value={shortDate(tm.designationDate)} />}
                  {abroad && (
                    <>
                      <Fact
                        label="Local agent"
                        value={
                          <InlineText
                            value={tm.localAgent ?? ''}
                            placeholder="Add agent"
                            ariaLabel="Local agent"
                            className="text-[13px] text-right text-stone-800 dark:text-stone-100"
                            onSave={(v) => patchField('localAgent', v || null)}
                          />
                        }
                      />
                      <Fact
                        label="Time to refuse"
                        value={
                          <span className="inline-flex rounded-md border border-stone-200 dark:border-white/10 overflow-hidden text-[11px]">
                            {([12, 18] as const).map((m) => (
                              <button key={m} type="button" onClick={() => void patchField('refusalPeriodMonths', m)}
                                className={`px-2 py-0.5 cursor-pointer ${(tm.refusalPeriodMonths ?? 12) === m ? 'bg-stone-800 text-white dark:bg-white/15' : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-white/5'}`}>
                                {m} mo
                              </button>
                            ))}
                          </span>
                        }
                      />
                    </>
                  )}
                </>
              ) : (
                <Fact label="Filed" value={tm.filingDate ? shortDate(tm.filingDate) : null} />
              )}
              {registered && (
                <Fact
                  label={madrid ? 'Protection granted' : 'Registered'}
                  value={
                    tm.regDate ? (
                      shortDate(tm.regDate)
                    ) : (
                      <button type="button" onClick={() => focusField('regDate', { focus: false })} className={`text-[12px] ${LINK}`}>
                        Set the date
                      </button>
                    )
                  }
                />
              )}
              <Fact
                label="Owner"
                value={
                  <InlineText
                    value={tm.owner ?? ''}
                    placeholder="Add owner"
                    ariaLabel="Owner"
                    className="text-[13px] text-right text-stone-800 dark:text-stone-100"
                    onSave={(v) => patchField('owner', v || null)}
                  />
                }
              />
              <Fact
                label="Contact email"
                value={
                  <InlineText
                    value={tm.contactEmail ?? ''}
                    placeholder="For client reports"
                    ariaLabel="Contact email"
                    type="email"
                    className="text-[13px] text-right text-stone-800 dark:text-stone-100"
                    onSave={(v) => patchField('contactEmail', v || null)}
                  />
                }
              />
              <Fact
                label="Client"
                value={<MarkClientPicker clientId={tm.clientId} clientName={tm.clientName} onChange={(v) => patchField('clientId', v)} />}
              />
            </dl>
          </SubjectCard>

          <SubjectCard title="Covered by" icon={<Users className="w-4 h-4" />}>
            <MarkMatterLinks trademarkId={tm.id} onUpdated={setTm} />
          </SubjectCard>

          <SubjectCard
            title="GPOA"
            icon={<FileStack className="w-4 h-4" />}
            action={<StatusPill label={tm.gpoaStatus} tone={tm.gpoaStatus === 'Filed' ? 'emerald' : 'amber'} />}
          >
            {tm.gpoaFiledDate && (
              <p className={`text-xs mb-2 ${MUTED}`}>
                Filed <EditableDate value={tm.gpoaFiledDate} onChange={(v) => (v ? patchField('gpoaFiledDate', v) : clearRefused())} />
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {gpoaUrl && (
                <a href={gpoaUrl} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1.5 text-xs ${LINK}`}>
                  <FileText className="w-3.5 h-3.5" /> View GPOA
                </a>
              )}
              <button
                type="button"
                onClick={() => gpoaFileInput.current?.click()}
                disabled={gpoaUploading}
                className={`${BTN_OUTLINE} ml-auto px-2.5 py-1.5`}
              >
                {gpoaUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {gpoaUploading ? 'Uploading…' : tm.gpoaFilePath ? 'Replace' : 'Upload GPOA'}
              </button>
              <input
                ref={gpoaFileInput}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadGpoa(f);
                  e.target.value = '';
                }}
              />
            </div>
          </SubjectCard>

          <SubjectCard title="Notes" icon={<NotebookPen className="w-4 h-4" />} bodyClassName="px-5 pb-5 space-y-4">
            <NotesField label="For the team" value={tm.notes ?? ''} placeholder="Anything the team should know…" onSave={(v) => patchField('notes', v || null)} />
            <NotesField
              label="Billing instructions"
              value={tm.billingInstructions ?? ''}
              placeholder="How to bill the client…"
              onSave={(v) => patchField('billingInstructions', v || null)}
            />
          </SubjectCard>
        </aside>
      </div>
    </div>
  );
}

/** Dates that carry a status can be corrected but not removed. */
function clearRefused(): Promise<boolean> {
  toast.message('That date can be changed but not cleared — it records a step the mark has passed.');
  return Promise.resolve(false);
}

// ── Header badge ────────────────────────────────────────────────────

/** The mark's logo, or its initials until there is one; click to upload or replace. */
function MarkBadge({ mark, imageUrl, uploading, onPick }: { mark: string; imageUrl: string | null; uploading: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={uploading}
      title={imageUrl ? 'Replace the mark image' : 'Upload the mark image'}
      className={`press group relative w-14 h-14 rounded-xl overflow-hidden shrink-0 shadow-sm ring-1 cursor-pointer ${
        imageUrl ? 'bg-white ring-stone-200 dark:ring-white/10' : 'bg-gradient-to-br from-navy-800 to-navy-950 ring-gold-400/30'
      }`}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={mark} className="w-full h-full object-contain p-1" />
      ) : (
        <span className="flex w-full h-full items-center justify-center font-serif text-lg tracking-wide text-gold-300">{monogram(mark || '?')}</span>
      )}
      <span
        className={`absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-navy-950/60 text-white transition-opacity ${
          uploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
        }`}
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        <span className="text-[9px] uppercase tracking-wider">{uploading ? 'Saving' : imageUrl ? 'Replace' : 'Add logo'}</span>
      </span>
    </button>
  );
}

// ── Next step ───────────────────────────────────────────────────────

const STEP_TONE: Record<NextStep['tone'], { dot: string; chip: { label: string; cls: string } | null }> = {
  overdue: { dot: 'bg-rose-500', chip: STATE_CHIP.overdue },
  soon: { dot: 'bg-amber-500', chip: { label: 'Due soon', cls: STATE_CHIP.waiting_on_client.cls } },
  clear: { dot: 'bg-emerald-500', chip: { label: 'All clear', cls: STATE_CHIP.done.cls } },
  default: { dot: 'bg-navy-400', chip: null },
  inactive: { dot: 'bg-stone-300 dark:bg-stone-600', chip: null },
};

/**
 * What the mark is waiting on, and the buttons that record it — the one
 * place on the page to act. Anything else owed this month sits beneath it
 * with its own button.
 */
function NextStepCard({
  tm,
  step,
  work,
  onRecorded,
  onPatch,
  onDraftExtension,
}: {
  tm: Trademark;
  step: NextStep;
  work: MarkDeliverablesState;
  onRecorded: (t: Trademark, spec: ActionSpec, file: FileEntry | null, officeActionId: string | null) => void;
  onPatch: PatchField;
  onDraftExtension: () => void;
}) {
  const tone = STEP_TONE[step.tone];
  const Icon = step.tone === 'clear' ? PartyPopper : CalendarClock;
  const today = manilaToday();
  // An extension can be asked for wherever the step offers to record one.
  // A designation's refusal records no MOTEX (its response date is the notice's), but more time can still be asked for.
  const extendible = step.actions.some((a) =>
    a.action === 'oa_response_motex' || a.action === 'dau_3_motex_filed' || (isDesignation(tm) && a.action === 'oa_response_filed'));
  // One or two buttons sit beside the step; more go underneath, so the step keeps its width.
  const workButtons = step.actions.filter((a) => isDeliverableAction(a.action)).length;
  const buttons = step.actions.length + workButtons + (step.recordDate ? 1 : 0) + (extendible ? 1 : 0);
  const beside = buttons <= 2;
  return (
    <SubjectCard
      title="Next step"
      icon={<Icon className="w-4 h-4" />}
      action={tone.chip && <span className={`px-1.5 py-0.5 rounded-md ring-1 ring-inset text-[10px] font-medium ${tone.chip.cls}`}>{tone.chip.label}</span>}
    >
      <div key={step.title} className={`reveal flex flex-col gap-3 ${beside ? 'md:flex-row md:items-center' : ''}`}>
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className={`mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-stone-900 dark:text-stone-50">{step.title}</p>
            {step.due && (
              <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${MUTED}`}>
                <span>Due</span>
                <span className="font-medium text-stone-800 dark:text-stone-100">{shortDate(step.due.due)}</span>
                <DueChip due={step.due.due} showDate={false} />
              </div>
            )}
            {step.due?.extendedDue && <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">{extensionNote(step.due)}</p>}
            {step.body && <p className={`text-sm mt-0.5 ${MUTED}`}>{step.body}</p>}
          </div>
        </div>
        {(step.actions.length > 0 || step.recordDate) && (
          <div className={`flex flex-wrap gap-2 ${beside ? 'md:justify-end' : 'pl-[18px]'}`}>
            {step.recordDate && (
              <DatedActionButton
                label={`Record the ${step.recordDate.label.charAt(0).toLowerCase()}${step.recordDate.label.slice(1)}`}
                primary
                fields={[{ key: 'value', label: step.recordDate.dateLabel, initial: null, allowFuture: step.recordDate.field !== 'regDate' }]}
                onRun={async (d) => {
                  const ok = await onPatch(step.recordDate!.field, d.value);
                  if (ok) toast.success(`${step.recordDate!.label} recorded`);
                  return ok;
                }}
              />
            )}
            {step.actions.map((a) => (
              <TrademarkActionButton
                key={a.action}
                trademarkId={tm.id}
                spec={a}
                regDate={tm.regDate}
                expectedRegDate={step.expectedRegDate}
                onDone={(t, file, oaId) => onRecorded(t, a, file, oaId)}
              />
            ))}
            {step.actions.filter((a) => isDeliverableAction(a.action)).map((a) => (
              <StepDeliverable
                key={`work:${a.action}`}
                state={work}
                action={a.action}
                officeActionId={a.officeActionId ?? null}
                label={a.action === 'oa_response_motex' || a.action === 'dau_3_motex_filed' ? 'Create extension deliverable' : 'Create deliverable'}
              />
            ))}
            {extendible && (
              <button type="button" onClick={onDraftExtension} className={`${BTN_OUTLINE} h-8 px-2.5 inline-flex items-center gap-1.5 text-xs`}>
                <FileText className="w-3.5 h-3.5" /> Draft extension request
              </button>
            )}
          </div>
        )}
      </div>

      {step.alsoOwed.length > 0 && (
        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-white/[0.06]">
          <p className={`text-[11px] uppercase tracking-wider font-semibold mb-1 ${MUTED}`}>Also due this month</p>
          <ul>
            {step.alsoOwed.map((d) => {
              const spec = actionForDeadline(d.label, d.officeAction);
              const oa = d.officeAction && tm.officeActions.find((o) => o.id === d.officeAction!.id);
              return (
                <li key={`${d.label}:${d.officeAction?.id ?? d.due}`} className="flex items-center gap-3 py-1.5">
                  <span className="flex-1 min-w-0 text-sm text-stone-800 dark:text-stone-100 truncate">
                    {oa ? `${officeActionName(tm.officeActions, oa)} — ${responseName(oa).toLowerCase()}` : d.label === 'Revival' ? deadlineLabel(d.label) : d.label}
                  </span>
                  <DueChip due={d.due} />
                  {spec && !(d.opens && d.opens > today) && (
                    <TrademarkActionButton
                      trademarkId={tm.id}
                      spec={{ ...spec, primary: false }}
                      size="sm"
                      onDone={(t, file, oaId) => onRecorded(t, spec, file, oaId)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SubjectCard>
  );
}

// ── Progress steps ──────────────────────────────────────────────────

/** A step's papers: open them, or attach one. */
interface StepDocs {
  files: FileEntry[];
  onOpenFiles: () => void;
  onAttach: () => void;
  attaching: boolean;
}

function ProgressStep({
  label, done, date, onDate, onUndo, detail, last, tone, files = [], onOpenFiles, onAttach, attaching,
}: {
  label: string;
  done: boolean;
  date?: string | null;
  onDate?: (v: string | null) => Promise<boolean>;
  /** Takes the step back; given only while there is something to take back. */
  onUndo?: () => void;
  detail?: React.ReactNode;
  last?: boolean;
  tone?: 'warn';
} & Partial<StepDocs>) {
  const dot = done
    ? tone === 'warn' ? 'bg-rose-500 border-rose-500' : 'bg-emerald-500 border-emerald-500'
    : 'bg-white dark:bg-card border-stone-300 dark:border-white/20';
  const labelCls = `text-sm ${done ? 'text-stone-900 dark:text-stone-50 font-medium' : MUTED}`;
  return (
    <li className={`relative flex gap-3 ${last ? '' : 'pb-4'}`}>
      {!last && (
        <span
          aria-hidden
          className={`absolute left-[9px] top-5 bottom-0 w-px transition-colors ${done ? 'bg-emerald-300 dark:bg-emerald-500/40' : 'bg-stone-200 dark:bg-white/10'}`}
        />
      )}
      <span className={`relative mt-0.5 w-[19px] h-[19px] rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${dot}`}>
        {done && <Check className="pop w-3 h-3 text-white" strokeWidth={3} />}
      </span>
      <div className="flex-1 min-w-0 flex flex-wrap items-baseline justify-between gap-x-3">
        {files.length > 0 && onOpenFiles ? (
          <button
            type="button"
            onClick={onOpenFiles}
            title={files.length === 1 ? `Open ${files[0].name}` : `Open the ${files.length} documents`}
            className={`${labelCls} inline-flex items-baseline gap-1.5 text-left cursor-pointer hover:text-navy-700 dark:hover:text-navy-300 underline decoration-stone-300 dark:decoration-white/20 underline-offset-4 hover:decoration-current transition-colors`}
          >
            {label}
            <span className="inline-flex items-center gap-0.5 text-[11px] font-normal text-stone-400 dark:text-stone-500 no-underline">
              <Paperclip className="w-3 h-3 self-center" />
              {files.length > 1 ? files.length : null}
            </span>
          </button>
        ) : (
          <p className={labelCls}>{label}</p>
        )}
        <span className="inline-flex items-baseline gap-3">
          {date && onDate && <EditableDate value={date} onChange={onDate} />}
          {done && onAttach && files.length === 0 && (
            <button
              type="button"
              onClick={onAttach}
              disabled={attaching}
              className="inline-flex items-center gap-1 text-xs text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200 underline-offset-2 hover:underline cursor-pointer disabled:opacity-60"
              title="Attach the document for this step"
            >
              {attaching ? <Loader2 className="w-3 h-3 animate-spin self-center" /> : <Paperclip className="w-3 h-3 self-center" />}
              Attach
            </button>
          )}
          {onUndo && <UndoLink onClick={onUndo} />}
        </span>
        {detail && <div className="basis-full">{detail}</div>}
      </div>
    </li>
  );
}

/** One Office Action round on the timeline: its receipt, then its answer. */
function OfficeActionSteps({
  oa, name, onPatch, onUndo, docs, onOpen, onRecorded,
}: {
  oa: TrademarkOfficeAction;
  name: string;
  onRecorded: Recorded;
  onOpen: (files: FileEntry[]) => void;
  onPatch: (field: string, value: string | null) => Promise<boolean>;
  onUndo: (action: TrademarkAction, label: string, officeActionId?: string) => void;
  docs: (step: TrademarkFileStep, officeActionId?: string) => StepDocs;
}) {
  const answer = responseName(oa);
  const response = docs('oa_response', oa.id);
  const motex = docs('oa_motex', oa.id);
  // Until the answer is in, the extension is the step's only paper, so it keeps its own attach.
  const pendingExtension = oa.motex && !oa.responseFiledDate;
  const answerDocs: StepDocs = pendingExtension ? response : {
    ...response,
    files: [...response.files, ...motex.files],
    onOpenFiles: () => onOpen([...response.files, ...motex.files]),
  };
  return (
    <Fragment>
      <ProgressStep
        done
        tone="warn"
        label={`${name} received`}
        date={oa.mailingDate}
        onDate={(v) => (v ? onPatch('mailingDate', v) : clearRefused())}
        onUndo={!oa.responseFiledDate && !oa.motex ? () => onUndo('oa_received', `${name} received`, oa.id) : undefined}
        detail={
          <div className={`text-xs mt-0.5 space-y-0.5 ${MUTED}`}>
            {oa.title && <p className="text-stone-700 dark:text-stone-200">{oa.title}</p>}
            <ReceivedLine value={oa.receivedDate} onChange={(v) => onPatch('receivedDate', v)} />
            {oa.respondBy && (
              <p>
                {oa.kind === 'provisional_refusal' ? 'Respond by (on the notice)' : 'Examiner’s deadline'} <EditableDate value={oa.respondBy} onChange={(v) => onPatch('respondBy', v)} />
              </p>
            )}
          </div>
        }
        {...docs('office_action', oa.id)}
      />
      <ProgressStep
        done={!!oa.responseFiledDate}
        label={oa.motex && !oa.responseFiledDate ? `${answer} (extension filed)` : `${answer} filed`}
        date={oa.responseFiledDate}
        onDate={(v) => (v ? onPatch('responseFiledDate', v) : clearRefused())}
        onUndo={
          oa.responseFiledDate
            ? () => onUndo('oa_response_filed', `${answer} filed`, oa.id)
            : oa.motex && !oa.motexDecision
              ? () => onUndo('oa_response_motex', 'Extension filed', oa.id)
              : undefined
        }
        detail={oa.motex ? (
          <div className="mt-0.5 space-y-0.5">
            {pendingExtension && (
              <p className={`text-xs inline-flex items-center gap-1 ${MUTED}`}>
                Extension request <RowDocs d={motex} />
              </p>
            )}
            <ExtensionDecisionLine
              decision={oa.motexDecision}
              decidedOn={oa.motexDecidedOn}
              onUndo={(action, label) => onUndo(action, label, oa.id)}
              of="oa"
              papers={docs('oa_motex_decision', oa.id)}
              trademarkId={oa.trademarkId}
              officeActionId={oa.id}
              onRecorded={onRecorded}
            />
          </div>
        ) : undefined}
        {...answerDocs}
      />
    </Fragment>
  );
}

/** The day a document arrived, under its own date — which is the one periods count from. */
function ReceivedLine({ value, onChange }: { value: string | null; onChange: (v: string | null) => Promise<boolean> }) {
  return (
    <p className={`text-xs ${MUTED}`}>
      Received <EditableDate value={value} onChange={onChange} placeholder="Unconfirmed · add the date" />
    </p>
  );
}

/** IPOPHL's answer to an extension request: awaited, or granted / denied on its order's date, with an Undo. */
type Recorded = (t: Trademark, spec: ActionSpec, file: FileEntry | null, officeActionId: string | null) => void;

/**
 * IPOPHL's answer to an extension request: awaited, with the buttons that
 * record it — here as well as on the next step, since it often comes after the
 * response or DAU is filed — or granted / denied on its order's date, with an Undo.
 */
function ExtensionDecisionLine({
  decision, decidedOn, onUndo, of, papers, trademarkId, officeActionId, onRecorded,
}: {
  decision: ExtensionDecision | null;
  decidedOn: string | null;
  onUndo: (action: TrademarkAction, label: string) => void;
  of: 'oa' | 'dau_3';
  /** IPOPHL's order, filed under the decision. */
  papers: StepDocs;
  trademarkId: string;
  officeActionId?: string;
  onRecorded: Recorded;
}) {
  if (!decision) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className={`text-[11px] ${TONE_TEXT.amber}`}>Awaiting IPOPHL’s decision on the extension</p>
        {extensionDecisionSpecs(of, officeActionId).map((spec) => (
          <TrademarkActionButton
            key={spec.action}
            trademarkId={trademarkId}
            spec={spec}
            size="sm"
            onDone={(t, file, oaId) => onRecorded(t, spec, file, oaId)}
          />
        ))}
      </div>
    );
  }
  const action = extensionDecisionAction(of, decision);
  const label = decision === 'granted' ? 'Extension granted' : 'Extension denied';
  return (
    <p className={`text-[11px] ${decision === 'denied' ? TONE_TEXT.rose : MUTED}`}>
      {label}
      {decidedOn && <> · order dated {formatDate(decidedOn)}</>}
      {decision === 'denied' && <> — the original period applies</>}
      {' '}
      <RowDocs d={papers} />
      {' · '}
      <UndoLink onClick={() => onUndo(action, label)} />
    </p>
  );
}

function UndoLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200 underline-offset-2 hover:underline cursor-pointer"
    >
      Undo
    </button>
  );
}

// ── Declarations & renewal ──────────────────────────────────────────

/** The timeline step each declarations & renewal row's papers are filed under. */
const UPKEEP_STEP: Record<string, TrademarkFileStep> = {
  '3dau': 'dau_3',
  '5dau': 'dau_5',
  renewal: 'renewal',
  rdau: 'renewal_dau',
  r5dau: 'renewal_dau_5',
};

/** The step each declarations & renewal row records. */
const UPKEEP_ACTION: Record<string, TrademarkAction> = {
  '3dau': 'dau_3_filed',
  '5dau': 'dau_5_filed',
  renewal: 'renewal_filed',
  rdau: 'renewal_dau_filed',
  r5dau: 'renewal_dau_5_filed',
};

function Obligations({
  tm, onPatch, onUndo, docs, onRecorded,
}: {
  tm: Trademark;
  onRecorded: Recorded;
  onPatch: PatchField;
  onUndo: (action: TrademarkAction, label: string) => void;
  docs: (step: TrademarkFileStep) => StepDocs;
}) {
  const rows = upkeepRows(tm);
  const today = manilaToday();

  return (
    <SubjectCard
      title="Declarations & renewal"
      icon={<ScrollText className="w-4 h-4" />}
      action={!tm.regDate ? <span className={`text-[11px] ${MUTED}`}>The 5-year DAU and renewal start once {isDesignation(tm) ? 'protection is granted' : 'registered'}</span> : undefined}
      bodyClassName="pb-4"
    >
      {rows.length === 0 ? (
        <p className={`px-5 text-sm ${MUTED}`}>Nothing to track until the registration date is in.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-stone-400 dark:text-stone-500 text-left">
                <th className="font-semibold px-5 py-2">Obligation</th>
                <th className="font-semibold px-3 py-2">Window</th>
                <th className="font-semibold px-3 py-2">Due</th>
                <th className="font-semibold px-5 py-2 text-right">Filed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-white/[0.06]">
              {rows.map((r) => {
                const w = r.window;
                const notOpen = !!w?.opens && w.opens > today;
                return (
                  <tr key={r.key} className="align-top hover:bg-stone-50/70 dark:hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-stone-900 dark:text-stone-50 whitespace-nowrap">{r.label}</p>
                      {r.note && <p className="text-[11px] text-stone-400 dark:text-stone-500">{r.note}</p>}
                      {r.motex && (
                        <p className={`text-[11px] ${MUTED}`}>
                          Extension (MOTEX) filed
                          {r.key === '3dau' && (
                            <>
                              {' '}
                              <RowDocs d={docs('dau_3_motex')} />
                              {!r.decision && (
                                <>
                                  {' · '}
                                  <UndoLink onClick={() => onUndo('dau_3_motex_filed', '3-year DAU extension filed')} />
                                </>
                              )}
                            </>
                          )}
                        </p>
                      )}
                      {r.motex && r.key === '3dau' && (
                        <ExtensionDecisionLine
                          decision={r.decision}
                          decidedOn={r.decidedOn}
                          onUndo={onUndo}
                          of="dau_3"
                          papers={docs('dau_3_motex_decision')}
                          trademarkId={tm.id}
                          onRecorded={onRecorded}
                        />
                      )}
                    </td>
                    <td className={`px-3 py-3 text-xs whitespace-nowrap ${MUTED}`}>{w?.opens ? `Opens ${formatDateShort(w.opens)}` : r.dueField ? '—' : 'Any time'}</td>
                    <td className="px-3 py-3">
                      {r.dueField && !r.filed ? (
                        <div className="flex flex-col items-start gap-0.5">
                          {w && <DueChip due={w.due} showDate={false} />}
                          <EditableDate
                            value={w?.due ?? null}
                            onChange={(v) => onPatch(r.dueField!, v)}
                            placeholder="Enter due date"
                          />
                        </div>
                      ) : !w ? (
                        '—'
                      ) : r.filed ? (
                        <span className={`text-xs whitespace-nowrap ${MUTED}`}>{formatDateShort(w.due)}</span>
                      ) : (
                        <div>
                          <DueChip due={w.due} />
                          {w.extendedDue && <p className="text-[11px] text-stone-400 dark:text-stone-500 mt-0.5">{extensionNote(w)}</p>}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {r.filed ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <EditableDate value={r.filed} onChange={(v) => onPatch(r.field, v)} />
                          <RowDocs d={docs(UPKEEP_STEP[r.key])} />
                          {UPKEEP_ACTION[r.key] && <UndoLink onClick={() => onUndo(UPKEEP_ACTION[r.key], `${r.label} filed`)} />}
                        </span>
                      ) : notOpen ? (
                        <span className="text-xs text-stone-400 dark:text-stone-500 whitespace-nowrap">Not open yet</span>
                      ) : (
                        <EditableDate value={null} onChange={(v) => onPatch(r.field, v)} placeholder="Record filing" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {tm.status === 'Registered' && (
        <div className="mx-5 mt-3 pt-3 border-t border-stone-100 dark:border-white/[0.06] flex flex-wrap items-center gap-4 text-xs">
          <span className={MUTED}>Client reminders sent:</span>
          <NudgeCheckbox label="1st" value={tm.nudge1} onChange={(v) => onPatch('nudge1', v)} />
          <NudgeCheckbox label="2nd" value={tm.nudge2} onChange={(v) => onPatch('nudge2', v)} />
          <NudgeCheckbox label="3rd" value={tm.nudge3} onChange={(v) => onPatch('nudge3', v)} />
          <Link href="/dashboard/trademarks/deadlines" className={`ml-auto inline-flex items-center gap-1 ${LINK}`}>
            Send a client report <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      )}
    </SubjectCard>
  );
}

/** A filed declaration's papers: a clip that opens them, or attaches one. */
function RowDocs({ d }: { d: StepDocs }) {
  const has = d.files.length > 0;
  return (
    <button
      type="button"
      onClick={has ? d.onOpenFiles : d.onAttach}
      disabled={d.attaching}
      title={has ? (d.files.length === 1 ? `Open ${d.files[0].name}` : `Open the ${d.files.length} documents`) : 'Attach the document'}
      aria-label={has ? 'Open the document' : 'Attach the document'}
      className={`p-0.5 rounded cursor-pointer transition-colors ${has ? 'text-navy-600 hover:text-navy-800 dark:text-navy-300' : 'text-stone-300 hover:text-stone-600 dark:text-stone-600 dark:hover:text-stone-300'}`}
    >
      {d.attaching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
    </button>
  );
}

/** A `request` extension has to be applied for before the original period
 *  lapses; a `surcharge` one is a late filing IPOPHL still accepts. */
function extensionNote(w: DeadlineWindow): string | null {
  if (!w.extendedDue) return null;
  return w.extensionBasis === 'surcharge'
    ? `Late filing to ${formatDateShort(w.extendedDue)} with surcharge`
    : `Extendible to ${formatDateShort(w.extendedDue)} — request before the due date, with fee`;
}

// ── Files / reports ─────────────────────────────────────────────────

function FilesCard({
  files, officeActions, loading, uploading, onPick, onDrop, onDelete, onOpen, onTag,
}: {
  files: FileEntry[];
  officeActions: TrademarkOfficeAction[];
  loading: boolean;
  uploading: boolean;
  onPick: () => void;
  onDrop: (files: File[]) => void;
  onDelete: (id: number) => void;
  onOpen: (f: FileEntry) => void;
  onTag: (fileId: number, step: TrademarkFileStep | null, officeActionId: string | null) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`rounded-2xl transition-shadow ${over ? 'ring-2 ring-navy-400/60 dark:ring-navy-300/50' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const list = Array.from(e.dataTransfer.files);
        if (list.length) onDrop(list);
      }}
    >
      <SubjectCard
        title="Files"
        icon={<FileText className="w-4 h-4" />}
        action={
          <button type="button" onClick={onPick} disabled={uploading} className={`${BTN_OUTLINE} px-2.5 py-1.5`}>
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploading ? 'Uploading…' : over ? 'Drop to upload' : 'Upload'}
          </button>
        }
      >
        {loading ? (
          <div className="space-y-2 py-1" aria-busy>
            {[0, 1].map((i) => (
              <div key={i} className="h-9 rounded-lg bg-stone-100 dark:bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : files.length === 0 ? (
          <button
            type="button"
            onClick={onPick}
            className={`w-full rounded-xl border border-dashed px-4 py-6 text-sm cursor-pointer transition-colors ${
              over
                ? 'border-navy-400 bg-navy-50/60 text-navy-800 dark:border-navy-300 dark:bg-navy-500/10 dark:text-navy-200'
                : 'border-stone-300 dark:border-white/15 text-stone-500 dark:text-stone-400 hover:text-stone-800 hover:border-navy-300 dark:hover:border-navy-400/60 dark:hover:text-stone-100'
            }`}
          >
            {over ? 'Drop to upload' : 'Drop the application, NOI, COR or other papers here, or click to choose'}
          </button>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
            {files.map((f, i) => (
              <li key={f.id} style={{ '--i': i } as React.CSSProperties} className="rise-in py-2 flex items-center gap-3 group">
                <FileText className="w-4 h-4 text-stone-400 dark:text-stone-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <button type="button" onClick={() => onOpen(f)} className={`text-sm truncate block max-w-full text-left cursor-pointer ${LINK}`}>
                    {f.name}
                  </button>
                  <span className="text-[11px] text-stone-400 dark:text-stone-500">
                    {[f.sizeBytes ? formatSize(f.sizeBytes) : null, f.uploadedAt ? formatDateShort(f.uploadedAt) : null].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <StepTag file={f} officeActions={officeActions} onTag={(step, oaId) => onTag(f.id, step, oaId)} />
                <button
                  type="button"
                  onClick={() => onDelete(f.id)}
                  className={`${BTN_GHOST_DANGER} p-1.5 sm:opacity-0 group-hover:opacity-100 focus:opacity-100`}
                  title="Remove"
                  aria-label={`Remove ${f.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SubjectCard>
    </div>
  );
}

/** Which step a paper is filed under, and a picker to move it. */
function StepTag({
  file, officeActions, onTag,
}: {
  file: FileEntry;
  officeActions: TrademarkOfficeAction[];
  onTag: (step: TrademarkFileStep | null, officeActionId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const label = fileStepLabel(file, officeActions);
  const value = file.step ? `${file.step}|${file.officeActionId ?? ''}` : 'none|';
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="File it under a step on the timeline"
        className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] cursor-pointer transition-colors ${
          label
            ? 'bg-navy-50 text-navy-700 hover:bg-navy-100 dark:bg-navy-500/10 dark:text-navy-200 dark:hover:bg-navy-500/20'
            : 'text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200 sm:opacity-0 group-hover:opacity-100 focus:opacity-100'
        }`}
      >
        <Tag className="w-3 h-3" />
        {label ?? 'Add to timeline'}
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={[{ id: 'none|', label: 'Not on the timeline' }, ...stepOptions(officeActions)]}
          minWidth={280}
          onSelect={(id) => {
            setOpen(false);
            if (!id || id === value) return;
            const [step, oaId] = id.split('|');
            onTag(step === 'none' ? null : (step as TrademarkFileStep), oaId || null);
          }}
          onClose={() => setOpen(false)}
          anchorRef={ref}
        />
      )}
    </>
  );
}

/** What the mark is filed for, one box per Nice class — the client reports print it class by class. */
function GoodsServicesCard({
  classes, value, onSave,
}: {
  classes: number[];
  value: Record<string, string>;
  onSave: (next: Record<string, string>) => Promise<boolean>;
}) {
  return (
    <SubjectCard title="Goods & services" icon={<Package className="w-4 h-4" />} bodyClassName="px-5 pb-5 space-y-4">
      {classes.length === 0 ? (
        <p className={`text-sm ${MUTED}`}>Add the mark&apos;s Nice classes above, then describe what each covers.</p>
      ) : (
        classes.map((c) => (
          <NotesField
            key={c}
            label={`Class ${c}`}
            value={value[String(c)] ?? ''}
            placeholder="As filed, e.g. Bags, wallets, purses; travel cases…"
            onSave={(text) => {
              const next = { ...value };
              if (text.trim()) next[String(c)] = text.trim();
              else delete next[String(c)];
              return onSave(next);
            }}
          />
        ))
      )}
    </SubjectCard>
  );
}

type OwedReport = { event: ReportEvent; date: string };

function owedReports(tm: Trademark, reports: ReportEntry[]): OwedReport[] {
  return owedReportEvents(tm, reports, manilaToday());
}

/** Sits at the top of the page so a report waiting to go out is seen on arrival, not at the bottom. */
function ReportsOwedCard({ owed, onPrepare }: { owed: OwedReport[]; onPrepare: (event: ReportEvent) => void }) {
  return (
    <div className="rounded-2xl border border-navy-200 bg-navy-50/70 px-4 py-3 dark:border-navy-400/20 dark:bg-navy-500/10">
      <p className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-navy-700 dark:text-navy-300">
        <Mail className="w-3.5 h-3.5" />
        {owed.length === 1 ? 'Client report to send' : `${owed.length} client reports to send`}
      </p>
      <ul className="mt-2 space-y-2">
        {owed.map((s) => (
          <li key={s.event} className="flex items-center justify-between gap-3">
            <p className="text-sm text-stone-800 dark:text-stone-100 min-w-0">
              <span className="font-medium">{REPORT_EVENTS[s.event].label}</span>
              <span className={`text-xs ${MUTED}`}> · {formatDate(s.date)} · not yet sent</span>
            </p>
            <button type="button" onClick={() => onPrepare(s.event)} className={`${BTN_PRIMARY} h-7 px-2.5 text-xs shrink-0`}>
              Review &amp; send
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportsCard({
  tm, reports, owed, loading, onPrepare, onOwnReport, onView, onOpenFile,
}: {
  tm: Trademark;
  reports: ReportEntry[];
  owed: OwedReport[];
  loading: boolean;
  onPrepare: (event: ReportEvent) => void;
  /** Send a report on the team's own paper, or record one that went out by other means. */
  onOwnReport: (mode: 'send' | 'record') => void;
  /** Open a sent report: the email as it went and its attachments. */
  onView: (reportId: number) => void;
  /** Preview one of a sent report's attachments. */
  onOpenFile: (files: ReportEntry['attachments'], index: number) => void;
}) {
  const others = reportableEvents(tm).filter((s) => !owed.some((o) => o.event === s.event && o.date === s.date));
  return (
    <SubjectCard title="Client reports" icon={<Mail className="w-4 h-4" />}>
      {loading ? (
        <div className="h-9 rounded-lg bg-stone-100 dark:bg-white/5 animate-pulse" aria-busy />
      ) : (
        <div className="space-y-3">
          {owed.length > 0 && (
            <p className={`text-sm ${MUTED}`}>
              {owed.length === 1 ? 'One report is' : `${owed.length} reports are`} waiting to be sent — see the top of the page.
            </p>
          )}
          {reports.length === 0 ? (
            owed.length === 0 && (
              <p className={`text-sm ${MUTED}`}>
                None sent yet. Deadline reminders go out from{' '}
                <Link href="/dashboard/trademarks/deadlines" className={LINK}>
                  Deadlines
                </Link>
                .
              </p>
            )
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
              {reports.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="text-sm text-stone-800 dark:text-stone-100">
                        {isReportEvent(r.event) && r.eventDate ? (
                          <>
                            <span className="font-medium">{REPORT_EVENTS[r.event].label}</span>
                            <span className="text-stone-400 dark:text-stone-500"> · </span>
                            <span>{formatDateShort(r.eventDate)}</span>
                          </>
                        ) : r.title ? (
                          <span className="font-medium">{r.title}</span>
                        ) : (
                          <>
                            <span className="font-medium">{r.deadlineKind}</span>
                            <span className="text-stone-400 dark:text-stone-500"> · due </span>
                            <span>{r.deadlineDue ? formatDateShort(r.deadlineDue) : '—'}</span>
                          </>
                        )}
                      </p>
                      <p className={`text-[11px] mt-0.5 ${MUTED}`}>
                        {r.subject === '(manual)' ? (
                          <span className="italic">Marked reported (no email)</span>
                        ) : r.sentOutside ? (
                          <>
                            <span className="italic">Sent outside the app</span>
                            {r.recipientEmail && <> · to {r.recipientEmail}</>}
                            {' · '}
                            <button type="button" onClick={() => onView(r.id)} className={`${LINK} cursor-pointer`}>
                              View
                            </button>
                          </>
                        ) : (
                          <>
                            To {r.recipientEmail || '—'}
                            {r.ccEmails.length > 0 && <> · cc {r.ccEmails.join(', ')}</>}
                            {' · '}
                            <button type="button" onClick={() => onView(r.id)} className={`${LINK} cursor-pointer`}>
                              View what was sent
                            </button>
                          </>
                        )}
                      </p>
                      {r.deliverable && (
                        <p className={`text-[11px] mt-0.5 truncate ${MUTED}`}>
                          Status report:{' '}
                          <Link href={`/dashboard/deliverables/${r.deliverable.id}`} className={LINK}>
                            {r.deliverable.name}
                          </Link>
                        </p>
                      )}
                    </div>
                    <div className={`text-right text-[11px] ${MUTED}`}>
                      <p>{formatDateShort(r.sentAt)}</p>
                      {r.sentByName && <p className="text-stone-400 dark:text-stone-500">{r.sentOutside ? 'recorded by' : 'by'} {r.sentByName}</p>}
                    </div>
                  </div>
                  {r.attachments.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {r.attachments.map((a, i) =>
                        a.url ? (
                          <button key={i} type="button" onClick={() => onOpenFile(r.attachments, i)} className={`inline-flex items-center gap-1 text-[11px] cursor-pointer ${LINK}`}>
                            <FileText className="w-3 h-3" /> {a.name}
                          </button>
                        ) : (
                          <span key={i} className="inline-flex items-center gap-1 text-[11px] text-stone-400 dark:text-stone-500">
                            <FileText className="w-3 h-3" /> {a.name}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <p className={`text-[11px] ${MUTED}`}>
              Prepare a report:{' '}
              {others.map((s, i) => (
                <Fragment key={s.event}>
                  {i > 0 && ' · '}
                  <button type="button" onClick={() => onPrepare(s.event)} className={`${LINK} cursor-pointer`}>
                    {REPORT_EVENTS[s.event].label}
                  </button>
                </Fragment>
              ))}
            </p>
          )}
          <p className={`text-[11px] ${MUTED}`}>
            On your own paper:{' '}
            <button type="button" onClick={() => onOwnReport('send')} className={`${LINK} cursor-pointer`}>
              Send your own report
            </button>
            {' · '}
            <button type="button" onClick={() => onOwnReport('record')} className={`${LINK} cursor-pointer`}>
              Record a report sent elsewhere
            </button>
          </p>
        </div>
      )}
    </SubjectCard>
  );
}

// ── Small editors ───────────────────────────────────────────────────

function TypePicker({ value, onChange }: { value: TrademarkType | null; onChange: (v: TrademarkType) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="press inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 dark:bg-white/[0.06] dark:text-stone-300 dark:hover:bg-white/10 text-[11px] cursor-pointer transition-colors"
        title="Change mark type"
      >
        {value ?? 'Set type'} <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={TYPES.map((t) => ({ id: t, label: t }))}
          onSelect={(id) => {
            setOpen(false);
            if (id && id !== value) void onChange(id as TrademarkType);
          }}
          onClose={() => setOpen(false)}
          anchorRef={ref}
        />
      )}
    </>
  );
}

/** Nice classes as chips; click to edit them as a comma-separated list. */
function ClassesEditor({ classes, onSave }: { classes: number[]; onSave: (v: number[]) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function begin() {
    setDraft(classes.join(', '));
    setEditing(true);
  }

  async function commit() {
    setEditing(false);
    const parsed = [...new Set(draft.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 45))].sort((a, b) => a - b);
    if (parsed.join(',') === classes.join(',')) return;
    await onSave(parsed);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        placeholder="e.g. 9, 35, 42"
        aria-label="Nice classes"
        className="w-44 px-2 py-0.5 text-xs font-mono text-stone-800 dark:text-stone-100 bg-transparent border border-navy-400 rounded-md focus:outline-none focus:ring-2 focus:ring-navy-400/20"
      />
    );
  }
  return (
    <button type="button" onClick={begin} className="group inline-flex flex-wrap items-center gap-1.5 cursor-pointer" title="Edit Nice classes">
      {classes.length === 0 ? (
        <span className={`text-xs ${LINK}`}>Add Nice classes</span>
      ) : (
        classes.map((c) => (
          <span key={c} className="inline-flex items-center px-1.5 py-px text-[10px] font-mono rounded bg-stone-100 text-stone-600 dark:bg-white/[0.06] dark:text-stone-300">
            Class {c}
          </span>
        ))
      )}
      <Pencil className="w-3 h-3 text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

/** Ticks straight away and puts itself back if the save fails. */
function NudgeCheckbox({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => Promise<boolean> }) {
  const [checked, setChecked] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setChecked(value);
  }
  return (
    <label className={`flex items-center gap-1.5 cursor-pointer ${MUTED}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={async (e) => {
          const next = e.target.checked;
          setChecked(next);
          if (!(await onChange(next))) setChecked(!next);
        }}
        className="rounded border-stone-300 dark:border-white/15 text-navy-700 dark:text-navy-300 focus:ring-navy-300 dark:focus:ring-navy-500/40"
      />
      {label}
    </label>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
