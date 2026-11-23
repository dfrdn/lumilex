'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight, ChevronLeft, ChevronDown, Clock, User, UserPlus,
  AlertTriangle, Check, X, Loader2, Trash2, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { failureMessage } from '@/lib/api-error';
import { CLIENT_RENAME_CONFIRM } from '@/lib/clients/rename-guard';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CellDropdown from '@/components/admin/CellDropdown';
import DatePickerInput from '@/components/DatePickerInput';
import dynamic from 'next/dynamic';
import type { RichCommentEditorHandle } from '@/components/detail/RichCommentEditor';

const SOURCE_OPTIONS = [
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
  { value: 'walk-in', label: 'Walk-in' },
  { value: 'event', label: 'Event' },
  { value: 'other', label: 'Other' },
];
import ConflictCheckResults from '@/components/conflicts/ConflictCheckResults';
import ProposalPanel from '@/components/prospects/ProposalPanel';
import type { ClientIntake, IntakeStageHistory, ConflictCheckResponse } from '@/types/conflicts';
import { confirmAction } from '@/components/ui/confirm';

// The rich-text editor (tiptap) loads on its own, behind a box of its height.
const RichCommentEditor = dynamic(() => import('@/components/detail/RichCommentEditor'), {
  ssr: false,
  loading: () => <div className="h-[7.9rem] rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)]" />,
});

const STAGES = [
  { value: 'Lead', color: 'bg-stone-500', ring: 'ring-stone-300 dark:ring-stone-600' },
  { value: 'Contacted', color: 'bg-blue-500', ring: 'ring-blue-300 dark:ring-blue-600' },
  { value: 'Consultation Scheduled', color: 'bg-amber-500', ring: 'ring-amber-300 dark:ring-amber-600' },
  { value: 'Consultation Done', color: 'bg-violet-500', ring: 'ring-violet-300 dark:ring-violet-600' },
  { value: 'Proposal Sent', color: 'bg-indigo-500', ring: 'ring-indigo-300 dark:ring-indigo-600' },
  { value: 'Engaged', color: 'bg-emerald-500', ring: 'ring-emerald-300 dark:ring-emerald-600' },
  { value: 'Declined', color: 'bg-red-500', ring: 'ring-red-300 dark:ring-red-600' },
] as const;

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

/** TipTap emits `<p></p>` for an empty document — treat that as cleared. */
function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

function formatDateTime(d: string): string {
  return new Date(d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}

interface Props {
  intakeId: number;
  canEdit: boolean;
}

type FieldValue = string | number | string[] | null;

interface PartnerOption {
  person_id: string;
  name: string;
  initials: string;
  position?: string;
  avatar_url?: string | null;
}

export default function IntakeDetailView({ intakeId, canEdit }: Props) {
  const router = useRouter();
  const [intake, setIntake] = useState<ClientIntake | null>(null);
  const [history, setHistory] = useState<IntakeStageHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Editable fields
  const [editingField, setEditingField] = useState<string | null>(null);
  const [renameConfirm, setRenameConfirm] = useState<{ field: string; value: FieldValue; message: string } | null>(null);
  const [editValue, setEditValue] = useState('');

  // Assigned partner picker
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const partnerRef = useRef<HTMLButtonElement>(null);

  // Rich-text consultation notes
  const [editingNotes, setEditingNotes] = useState(false);
  const notesRef = useRef<RichCommentEditorHandle>(null);

  const fetchIntake = useCallback(async () => {
    const res = await fetch(`/api/intakes?id=${intakeId}`);
    if (res.ok) {
      const data = await res.json();
      setIntake(data.intake);
      setHistory(data.history ?? []);
    }
    setLoading(false);
  }, [intakeId]);

  useEffect(() => { fetchIntake(); }, [fetchIntake]);

  useEffect(() => {
    if (!canEdit) return;
    let alive = true;
    // Prospects are assigned to a partner, not to any lawyer.
    fetch('/api/people?role=partners')
      .then((r) => r.json())
      .then((d) => { if (alive) setPartners(d.people ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [canEdit]);

  const updateField = async (field: string, value: FieldValue, confirmRename = false): Promise<boolean> => {
    setUpdating(true);
    const res = await fetch('/api/intakes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: intakeId, updates: { [field]: value }, ...(confirmRename && { confirmRename: true }) }),
    });
    if (res.ok) {
      setIntake((prev) => prev ? { ...prev, [field]: value } : prev);
      setEditingField(null);
    } else {
      // Keep the editor open on failure — closing it would discard what was
      // typed and leave the old value looking like it saved.
      const err = await res.clone().json().catch(() => null);
      if (err?.code === CLIENT_RENAME_CONFIRM) setRenameConfirm({ field, value, message: err.error });
      else toast.error(await failureMessage(res, 'Could not save that change.'));
    }
    setUpdating(false);
    return res.ok;
  };

  /** Reassignment has to move the resolved name too — it comes from the API, not the row. */
  const assignPartner = async (personId: string | null) => {
    setPartnerOpen(false);
    if (!intake || personId === (intake.assigned_lawyer_id ?? null)) return;
    const previous = { id: intake.assigned_lawyer_id, name: intake.assigned_lawyer_name };
    const name = personId ? partners.find((p) => p.person_id === personId)?.name : undefined;
    setIntake((prev) => prev ? { ...prev, assigned_lawyer_id: personId, assigned_lawyer_name: name } : prev);
    setUpdating(true);
    const res = await fetch('/api/intakes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: intakeId, updates: { assigned_lawyer_id: personId } }),
    });
    if (!res.ok) {
      setIntake((prev) => prev
        ? { ...prev, assigned_lawyer_id: previous.id, assigned_lawyer_name: previous.name }
        : prev);
      toast.error(await failureMessage(res, 'Could not reassign this prospect.'));
    }
    setUpdating(false);
  };

  const saveNotes = async () => {
    const content = notesRef.current?.getContent();
    if (!content) return;
    const ok = await updateField('consultation_notes', isBlankHtml(content.html) ? '' : content.html);
    if (ok) setEditingNotes(false);
  };

  const deleteIntake = async () => {
    if (!(await confirmAction({ title: 'Delete this prospect?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    setDeleting(true);
    const res = await fetch('/api/intakes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: intakeId }),
    });
    if (res.ok) {
      const backHref = window.location.pathname.startsWith('/admin')
        ? '/admin/prospects'
        : '/dashboard/prospects';
      router.push(backHref);
    } else {
      setDeleting(false);
      toast.error(await failureMessage(res, 'Could not delete this prospect.'));
    }
  };

  const moveStage = async (newStage: ClientIntake['stage']) => {
    if (!intake) return;
    const previousStage = intake.stage;
    // Optimistic — the stepper reflects the new stage instantly.
    setIntake((prev) => prev ? { ...prev, stage: newStage } : prev);
    setUpdating(true);
    try {
      const res = await fetch('/api/intakes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: intakeId, updates: { stage: newStage } }),
      });
      if (!res.ok) throw new Error(await failureMessage(res, `Could not move this prospect to ${newStage}.`));
      // Background refetch to pick up the server-generated history entry.
      fetchIntake();
    } catch (err) {
      // Revert on failure
      setIntake((prev) => prev ? { ...prev, stage: previousStage } : prev);
      toast.error(err instanceof Error ? err.message : `Could not move this prospect to ${newStage}.`);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-navy-300 border-t-navy-600 dark:border-navy-500/40 dark:border-t-navy-300 rounded-full animate-spin" />
      </div>
    );
  }

  if (!intake) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2" />
        <p className="text-sm text-[var(--text-muted)]">Intake record not found</p>
      </div>
    );
  }

  const currentStageIdx = STAGES.findIndex((s) => s.value === intake.stage);
  const conflictResult = intake.conflict_check_result as ConflictCheckResponse | null;
  const days = daysAgo(intake.created_at);

  return (
    <div className="space-y-6">
      {/* Stage stepper */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Pipeline Stage
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <Clock className="w-3 h-3" />
              {days === 0 ? 'Created today' : `${days} days in pipeline`}
            </div>
            {canEdit && (
              <button
                onClick={deleteIntake}
                disabled={deleting}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400 transition-colors"
                title="Delete prospect"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 mb-5">
          {STAGES.map((stage, idx) => {
            const isCurrent = idx === currentStageIdx;
            const isPast = idx < currentStageIdx;
            const isDeclined = intake.stage === 'Declined' && stage.value === 'Declined';
            return (
              <div key={stage.value} className="flex-1 flex flex-col items-center gap-1.5">
                <div
                  className={`w-full h-2 rounded-full transition-colors ${
                    isCurrent || isDeclined
                      ? `${stage.color} ring-2 ${stage.ring}`
                      : isPast
                      ? stage.color
                      : 'bg-[var(--border-color)]'
                  }`}
                />
                <span className={`text-[9px] font-medium text-center leading-tight ${
                  isCurrent || isDeclined ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
                }`}>
                  {stage.value}
                </span>
              </div>
            );
          })}
        </div>

        {/* Stage actions */}
        {canEdit && intake.stage !== 'Engaged' && intake.stage !== 'Declined' && (
          <div className="flex items-center gap-2">
            {currentStageIdx > 0 && (
              <button
                onClick={() => moveStage(STAGES[currentStageIdx - 1].value)}
                disabled={updating}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back to {STAGES[currentStageIdx - 1].value}
              </button>
            )}
            {currentStageIdx < STAGES.length - 2 && (
              <button
                onClick={() => moveStage(STAGES[currentStageIdx + 1].value)}
                disabled={updating}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-600 text-white hover:bg-navy-700 disabled:opacity-50 transition-colors"
              >
                Move to {STAGES[currentStageIdx + 1].value}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
            {currentStageIdx >= 3 && (
              <button
                onClick={() => moveStage('Engaged')}
                disabled={updating}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                Convert to Active Client
              </button>
            )}
            <button
              onClick={() => moveStage('Declined')}
              disabled={updating}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 transition-colors ml-auto dark:text-red-400"
            >
              <X className="w-3.5 h-3.5" />
              Decline
            </button>
          </div>
        )}

        {intake.stage === 'Engaged' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
            <Check className="w-4 h-4" />
            Client has been converted to Active
          </div>
        )}
        {intake.stage === 'Declined' && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-xs font-medium">
            <X className="w-4 h-4" />
            Prospect was declined
            {intake.declined_reason && <span className="font-normal">— {intake.declined_reason}</span>}
          </div>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Client info */}
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border-color)]">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Client Information
            </h2>
          </div>
          <div className="px-6 py-4 space-y-3">
            <EditableField
              label="Name"
              value={intake.client_name || '—'}
              canEdit={canEdit}
              onEdit={() => { setEditingField('client_name'); setEditValue(intake.client_name ?? ''); }}
              editing={editingField === 'client_name'}
              editValue={editValue}
              onEditChange={setEditValue}
              onSave={() => updateField('client_name', editValue)}
              onCancel={() => setEditingField(null)}
              saving={updating}
            />
            <EditableField
              label="Full Company Name"
              value={intake.client_full_name || '—'}
              canEdit={canEdit}
              onEdit={() => { setEditingField('client_full_name'); setEditValue(intake.client_full_name ?? ''); }}
              editing={editingField === 'client_full_name'}
              editValue={editValue}
              onEditChange={setEditValue}
              onSave={() => updateField('client_full_name', editValue)}
              onCancel={() => setEditingField(null)}
              saving={updating}
            />
            <EditableField
              label="Email"
              value={intake.client_email || '—'}
              canEdit={canEdit}
              onEdit={() => { setEditingField('client_email'); setEditValue(intake.client_email ?? ''); }}
              editing={editingField === 'client_email'}
              editValue={editValue}
              onEditChange={setEditValue}
              onSave={() => updateField('client_email', editValue)}
              onCancel={() => setEditingField(null)}
              saving={updating}
            />
            <EditableField
              label="Phone"
              value={intake.client_phone || '—'}
              canEdit={canEdit}
              onEdit={() => { setEditingField('client_phone'); setEditValue(intake.client_phone ?? ''); }}
              editing={editingField === 'client_phone'}
              editValue={editValue}
              onEditChange={setEditValue}
              onSave={() => updateField('client_phone', editValue)}
              onCancel={() => setEditingField(null)}
              saving={updating}
            />
            <EditableField
              label="TIN"
              value={intake.client_tin || '—'}
              canEdit={canEdit}
              onEdit={() => { setEditingField('client_tin'); setEditValue(intake.client_tin ?? ''); }}
              editing={editingField === 'client_tin'}
              editValue={editValue}
              onEditChange={setEditValue}
              onSave={() => updateField('client_tin', editValue)}
              onCancel={() => setEditingField(null)}
              saving={updating}
            />
            <EditableField
              label="Source"
              value={SOURCE_OPTIONS.find((o) => o.value === intake.source)?.label || intake.source || '—'}
              canEdit={canEdit}
              onEdit={() => { setEditingField('source'); setEditValue(intake.source ?? 'referral'); }}
              editing={editingField === 'source'}
              editValue={editValue}
              onEditChange={setEditValue}
              onSave={(override) => updateField('source', override ?? editValue)}
              onCancel={() => setEditingField(null)}
              inputType="select"
              selectOptions={SOURCE_OPTIONS}
              saving={updating}
            />
            <EditableField
              label="Referral Source"
              value={intake.referral_source || '—'}
              canEdit={canEdit}
              onEdit={() => { setEditingField('referral_source'); setEditValue(intake.referral_source ?? ''); }}
              editing={editingField === 'referral_source'}
              editValue={editValue}
              onEditChange={setEditValue}
              onSave={() => updateField('referral_source', editValue)}
              onCancel={() => setEditingField(null)}
              saving={updating}
            />
            {/* Always rendered, even unassigned — otherwise a prospect created
                without a partner could never be given one. */}
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Assigned Partner
              </p>
              {canEdit ? (
                <>
                  <button
                    type="button"
                    ref={partnerRef}
                    onClick={() => setPartnerOpen((o) => !o)}
                    disabled={updating}
                    className="group w-full flex items-center justify-between gap-2 -mx-2 px-2 py-1 rounded-lg text-left hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors"
                    title="Click to reassign"
                  >
                    <span className={`text-sm ${intake.assigned_lawyer_name ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                      {intake.assigned_lawyer_name || 'Unassigned'}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </button>
                  {partnerOpen && (
                    <CellDropdown
                      mode="single"
                      value={intake.assigned_lawyer_id}
                      options={partners.map((p) => ({
                        id: p.person_id,
                        label: p.name,
                        sublabel: p.position || '',
                        initials: p.initials,
                        avatarUrl: p.avatar_url ?? null,
                      }))}
                      onSelect={assignPartner}
                      onClose={() => setPartnerOpen(false)}
                      anchorRef={partnerRef}
                      placeholder="Search partners…"
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-[var(--text-primary)]">{intake.assigned_lawyer_name || '—'}</p>
              )}
            </div>
            {intake.created_by_name && (
              <InfoRow icon={UserPlus} label="Added By" value={intake.created_by_name} />
            )}
          </div>
        </div>

        {/* Intake details */}
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border-color)]">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Intake Details
            </h2>
          </div>
          <div className="px-6 py-4 space-y-3">
            {/* Consultation date */}
            <EditableField
              label="Consultation Date"
              value={intake.consultation_date ? formatDate(intake.consultation_date) : '—'}
              canEdit={canEdit}
              onEdit={() => { setEditingField('consultation_date'); setEditValue(intake.consultation_date?.slice(0, 10) ?? ''); }}
              editing={editingField === 'consultation_date'}
              editValue={editValue}
              onEditChange={setEditValue}
              onSave={() => updateField('consultation_date', editValue || null)}
              onCancel={() => setEditingField(null)}
              inputType="date"
              saving={updating}
            />

            {/* Proposed services */}
            <EditableField
              label="Proposed Services"
              value={intake.proposed_services?.length ? intake.proposed_services.join(', ') : '—'}
              canEdit={canEdit}
              onEdit={() => { setEditingField('proposed_services'); setEditValue(intake.proposed_services?.join(', ') ?? ''); }}
              editing={editingField === 'proposed_services'}
              editValue={editValue}
              onEditChange={setEditValue}
              onSave={() => updateField('proposed_services', editValue.split(',').map((s) => s.trim()).filter(Boolean))}
              onCancel={() => setEditingField(null)}
              saving={updating}
              hint="Comma-separated"
            />

            {/* Proposed fee */}
            <EditableField
              label="Proposed Fee"
              value={intake.proposed_fee ? `₱${Number(intake.proposed_fee).toLocaleString()}` : '—'}
              canEdit={canEdit}
              onEdit={() => { setEditingField('proposed_fee'); setEditValue(intake.proposed_fee?.toString() ?? ''); }}
              editing={editingField === 'proposed_fee'}
              editValue={editValue}
              onEditChange={setEditValue}
              onSave={() => updateField('proposed_fee', editValue ? Number(editValue) : null)}
              onCancel={() => setEditingField(null)}
              inputType="number"
              saving={updating}
            />

            {/* Declined reason */}
            {intake.stage === 'Declined' && (
              <EditableField
                label="Declined Reason"
                value={intake.declined_reason || '—'}
                canEdit={canEdit}
                onEdit={() => { setEditingField('declined_reason'); setEditValue(intake.declined_reason ?? ''); }}
                editing={editingField === 'declined_reason'}
                editValue={editValue}
                onEditChange={setEditValue}
                onSave={() => updateField('declined_reason', editValue)}
                onCancel={() => setEditingField(null)}
                saving={updating}
              />
            )}
          </div>
        </div>
      </div>

      {/* Consultation notes — full width, rich text */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Consultation Notes
          </h2>
          {canEdit && !editingNotes && (
            <button
              onClick={() => setEditingNotes(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Pencil className="w-3 h-3" />
              {intake.consultation_notes ? 'Edit' : 'Add notes'}
            </button>
          )}
        </div>
        <div className="px-6 py-4">
          {editingNotes ? (
            <div className="space-y-2">
              {/* No team list — @-mentions here would render a chip that
                  notifies nobody. Formatting only. */}
              <RichCommentEditor
                ref={notesRef}
                teamMembers={[]}
                initialHtml={intake.consultation_notes}
                placeholder="What came out of the consultation?"
                autoFocus
                hideSubmit
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={saveNotes}
                  disabled={updating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-[#1A1816] bg-gold-400 hover:bg-gold-500 rounded-md disabled:opacity-50 transition-colors"
                >
                  {updating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Save
                </button>
                <button
                  onClick={() => setEditingNotes(false)}
                  className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          ) : intake.consultation_notes ? (
            <div
              className="prose prose-sm prose-stone dark:prose-invert max-w-none text-[13.5px] text-[var(--text-primary)] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: intake.consultation_notes }}
            />
          ) : (
            <p className="text-sm text-[var(--text-muted)]">No consultation notes yet.</p>
          )}
        </div>
      </div>

      {/* Conflict check results */}
      {conflictResult && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border-color)]">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Conflict Check Results
            </h2>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              Checked at {formatDateTime(conflictResult.checkedAt)}
            </p>
          </div>
          <div className="px-6 py-4">
            <ConflictCheckResults result={conflictResult} />
          </div>
        </div>
      )}

      <ProposalPanel intakeId={intakeId} canEdit={canEdit} />

      {/* Stage history */}
      {history.length > 0 && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--border-color)]">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Stage History
            </h2>
          </div>
          <div className="divide-y divide-[var(--border-color)]">
            {history.map((h) => (
              <div key={h.id} className="px-6 py-3 flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--text-primary)]">
                    <span className="font-medium">{h.old_stage}</span>
                    {' → '}
                    <span className="font-medium">{h.new_stage}</span>
                  </p>
                  {h.notes && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{h.notes}</p>}
                </div>
                <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                  {formatDateTime(h.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={renameConfirm !== null}
        onConfirm={() => {
          if (!renameConfirm) return;
          const { field, value } = renameConfirm;
          setRenameConfirm(null);
          void updateField(field, value, true);
        }}
        onCancel={() => setRenameConfirm(null)}
        title="Rename this client?"
        message={renameConfirm?.message ?? ''}
        confirmLabel="Rename"
        variant="danger"
      />
    </div>
  );
}

function InfoRow({ icon: Icon, label, value, mono }: { icon: typeof User; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-3.5 h-3.5 text-[var(--text-muted)] mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
        <p className={`text-sm text-[var(--text-primary)] ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
    </div>
  );
}

function EditableField({
  label, value, canEdit, onEdit, editing, editValue, onEditChange, onSave, onCancel, inputType, selectOptions, saving, hint,
}: {
  label: string;
  value: string;
  canEdit: boolean;
  onEdit: () => void;
  editing: boolean;
  editValue: string;
  onEditChange: (v: string) => void;
  /** `override` lets a control that already knows its new value skip the editValue round-trip. */
  onSave: (override?: string) => void;
  onCancel: () => void;
  inputType?: 'text' | 'date' | 'number' | 'select';
  selectOptions?: { value: string; label: string }[];
  saving?: boolean;
  hint?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // A single-select commits on pick, so it needs no save/cancel rail — the
  // dropdown is the whole editor and it anchors to the row it replaces.
  if (editing && inputType === 'select') {
    return (
      <div ref={rowRef} className="space-y-1">
        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
        <p className="text-sm text-[var(--text-primary)]">
          {selectOptions?.find((o) => o.value === editValue)?.label ?? value}
        </p>
        <CellDropdown
          mode="single"
          value={editValue || null}
          options={(selectOptions ?? []).map((o) => ({ id: o.value, label: o.label }))}
          onSelect={(id) => (id ? onSave(id) : onCancel())}
          onClose={onCancel}
          anchorRef={rowRef}
        />
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-1">
        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
        <div className="flex items-start gap-1.5">
          {inputType === 'date' ? (
            <DatePickerInput
              variant="token"
              className="flex-1"
              value={editValue || null}
              onChange={(v) => onEditChange(v ?? '')}
              placeholder="Select date"
            />
          ) : (
            <input
              autoFocus
              type={inputType || 'text'}
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }}
              className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30"
            />
          )}
          <button onClick={() => onSave()} disabled={saving} className="p-1.5 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg disabled:opacity-50 dark:text-emerald-400">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onCancel} className="p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] rounded-lg">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {hint && <p className="text-[10px] text-[var(--text-muted)]">{hint}</p>}
      </div>
    );
  }

  return (
    <div
      className={`group relative flex items-start justify-between gap-2 ${canEdit ? 'cursor-pointer hover:bg-[var(--bg-hover)] -mx-2 px-2 py-1 rounded-lg transition-colors' : ''}`}
      onClick={canEdit ? onEdit : undefined}
      title={canEdit ? 'Click to edit' : undefined}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider">{label}</p>
        <p className="text-sm text-[var(--text-primary)] break-words">{value}</p>
      </div>
      {canEdit && (
        <Pencil className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
      )}
    </div>
  );
}
