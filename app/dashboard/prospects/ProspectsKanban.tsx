'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { Plus, ChevronRight, ChevronLeft, Clock, User, UserPlus, Phone, Mail, Building2, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { failureMessage } from '@/lib/api-error';
import type { ClientIntake, ConflictCheckResponse } from '@/types/conflicts';
import NewProspectModal from '@/components/prospects/NewProspectModal';
import { confirmAction } from '@/components/ui/confirm';

const DRAG_MIME = 'application/x-intake-id';

const STAGES = [
  { value: 'Lead', color: 'bg-stone-500', lightBg: 'bg-stone-50 dark:bg-stone-500/10', border: 'border-stone-200 dark:border-stone-500/20' },
  { value: 'Contacted', color: 'bg-blue-500', lightBg: 'bg-blue-50 dark:bg-blue-500/10', border: 'border-blue-200 dark:border-blue-500/20' },
  { value: 'Consultation Scheduled', color: 'bg-amber-500', lightBg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200 dark:border-amber-500/20' },
  { value: 'Consultation Done', color: 'bg-violet-500', lightBg: 'bg-violet-50 dark:bg-violet-500/10', border: 'border-violet-200 dark:border-violet-500/20' },
  { value: 'Proposal Sent', color: 'bg-indigo-500', lightBg: 'bg-indigo-50 dark:bg-indigo-500/10', border: 'border-indigo-200 dark:border-indigo-500/20' },
  { value: 'Engaged', color: 'bg-emerald-500', lightBg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20' },
  { value: 'Declined', color: 'bg-red-500', lightBg: 'bg-red-50 dark:bg-red-500/10', border: 'border-red-200 dark:border-red-500/20' },
];

function daysAgo(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function getStageIndex(stage: string): number {
  return STAGES.findIndex((s) => s.value === stage);
}

export default function ProspectsKanban() {
  const [showNewModal, setShowNewModal] = useState(false);
  const [updating, setUpdating] = useState<number | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const { data, error, mutate } = useSWR<{ intakes: ClientIntake[] }>('/api/intakes?pageSize=200');
  const intakes = data?.intakes ?? [];
  const loading = !data && !error;
  const fetchIntakes = useCallback(() => { void mutate(); }, [mutate]);
  const setIntakes = useCallback(
    (next: ClientIntake[] | ((prev: ClientIntake[]) => ClientIntake[])) =>
      mutate((d) => ({ ...d, intakes: typeof next === 'function' ? next(d?.intakes ?? []) : next }), { revalidate: false }),
    [mutate],
  );

  const moveStage = async (intakeId: number, newStage: string) => {
    const current = intakes.find((i) => i.id === intakeId);
    if (!current || current.stage === newStage) return;
    setUpdating(intakeId);
    // Optimistic update — revert if the request fails.
    setIntakes((prev) => prev.map((i) => i.id === intakeId ? { ...i, stage: newStage as ClientIntake['stage'] } : i));
    const res = await fetch('/api/intakes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: intakeId, updates: { stage: newStage } }),
    });
    if (!res.ok) {
      // The card snapping back is not self-explanatory — say why it moved back.
      setIntakes((prev) => prev.map((i) => i.id === intakeId ? { ...i, stage: current.stage } : i));
      toast.error(await failureMessage(res, `Could not move ${current.client_name || 'this prospect'} to ${newStage}.`));
    }
    setUpdating(null);
  };

  const deleteIntake = async (intakeId: number) => {
    if (!(await confirmAction({ title: 'Delete this prospect?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    const previous = intakes;
    setIntakes((prev) => prev.filter((i) => i.id !== intakeId));
    const res = await fetch('/api/intakes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: intakeId }),
    });
    if (!res.ok) {
      setIntakes(previous);
      toast.error(await failureMessage(res, 'Could not delete this prospect.'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-navy-300 border-t-navy-600 rounded-full animate-spin dark:border-stone-700 dark:border-t-navy-300" />
      </div>
    );
  }

  return (
    <>
      {/* Header actions */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-[var(--text-muted)]">{intakes.length} prospect{intakes.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setShowNewModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-gold-500 hover:bg-gold-600 rounded-xl shadow-sm transition-all"
        >
          <Plus className="w-4 h-4" />
          New Prospect
        </button>
      </div>

      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
        {STAGES.map((stage) => {
          const stageIntakes = intakes.filter((i) => i.stage === stage.value);
          const isDropTarget = dragOverStage === stage.value;
          return (
            <div
              key={stage.value}
              className="flex-shrink-0 w-72"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(DRAG_MIME)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverStage !== stage.value) setDragOverStage(stage.value);
                }
              }}
              onDragLeave={(e) => {
                // Only clear if we actually left the column, not just entered a child.
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverStage((curr) => (curr === stage.value ? null : curr));
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const raw = e.dataTransfer.getData(DRAG_MIME);
                const id = raw ? parseInt(raw, 10) : NaN;
                setDragOverStage(null);
                setDraggingId(null);
                if (!Number.isNaN(id)) moveStage(id, stage.value);
              }}
            >
              {/* Column header */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
                <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                  {stage.value}
                </h3>
                <span className="ml-auto text-[11px] font-medium text-[var(--text-muted)] bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded">
                  {stageIntakes.length}
                </span>
              </div>

              {/* Cards */}
              <div
                className={`space-y-2.5 min-h-[80px] rounded-xl transition-colors ${
                  isDropTarget ? `${stage.lightBg} ring-2 ring-inset ${stage.border}` : ''
                }`}
              >
                {stageIntakes.map((intake) => (
                  <IntakeCard
                    key={intake.id}
                    intake={intake}
                    stageConfig={stage}
                    onMoveForward={() => {
                      const nextIdx = getStageIndex(intake.stage) + 1;
                      if (nextIdx < STAGES.length) moveStage(intake.id, STAGES[nextIdx].value);
                    }}
                    onMoveBack={() => {
                      const prevIdx = getStageIndex(intake.stage) - 1;
                      if (prevIdx >= 0) moveStage(intake.id, STAGES[prevIdx].value);
                    }}
                    onDelete={() => deleteIntake(intake.id)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, String(intake.id));
                      e.dataTransfer.effectAllowed = 'move';
                      setDraggingId(intake.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDragOverStage(null);
                    }}
                    isDragging={draggingId === intake.id}
                    isFirst={getStageIndex(intake.stage) === 0}
                    isLast={getStageIndex(intake.stage) === STAGES.length - 1}
                    isUpdating={updating === intake.id}
                  />
                ))}
                {stageIntakes.length === 0 && (
                  <div className={`rounded-xl border border-dashed ${stage.border} px-4 py-8 text-center`}>
                    <p className="text-[11px] text-[var(--text-muted)]">{isDropTarget ? 'Drop here' : 'No prospects'}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* New Prospect Modal */}
      <NewProspectModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onSuccess={() => { setShowNewModal(false); fetchIntakes(); }}
      />
    </>
  );
}

function IntakeCard({
  intake,
  stageConfig,
  onMoveForward,
  onMoveBack,
  onDelete,
  onDragStart,
  onDragEnd,
  isDragging,
  isFirst,
  isLast,
  isUpdating,
}: {
  intake: ClientIntake;
  stageConfig: typeof STAGES[number];
  onMoveForward: () => void;
  onMoveBack: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isFirst: boolean;
  isLast: boolean;
  isUpdating: boolean;
}) {
  const days = daysAgo(intake.created_at);
  const conflictCheck = intake.conflict_check_result as ConflictCheckResponse | null;
  const hasConflicts = conflictCheck && conflictCheck.conflicts.length > 0;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`bg-[var(--card-bg)] rounded-xl border ${stageConfig.border} shadow-sm hover:shadow-md transition-all p-4 cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-50' : ''}`}>
      {/* Client name */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <a
          draggable={false}
          href={`${window.location.pathname.startsWith('/admin') ? '/admin' : '/dashboard'}/prospects/${intake.id}`}
          className="text-sm font-semibold text-[var(--text-primary)] hover:text-gold-600 dark:hover:text-gold-400 transition-colors line-clamp-2"
        >
          {intake.client_name || 'Unnamed Client'}
        </a>
        {hasConflicts ? (
          <span className="shrink-0" aria-label={`${conflictCheck!.conflicts.length} potential conflict(s)`}>
            <ShieldAlert className="w-4 h-4 text-amber-500" />
          </span>
        ) : conflictCheck ? (
          <span className="shrink-0" aria-label="No conflicts">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
          </span>
        ) : null}
      </div>

      {/* Details */}
      <div className="space-y-1 mb-3">
        {intake.client_email && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <Mail className="w-3 h-3" /> {intake.client_email}
          </div>
        )}
        {intake.client_phone && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <Phone className="w-3 h-3" /> {intake.client_phone}
          </div>
        )}
        {intake.source && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <Building2 className="w-3 h-3" /> {intake.source}{intake.referral_source ? `: ${intake.referral_source}` : ''}
          </div>
        )}
        {intake.assigned_lawyer_name && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]" title="Assigned partner">
            <User className="w-3 h-3" /> {intake.assigned_lawyer_name}
          </div>
        )}
        {intake.created_by_name && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]" title="Who added this prospect">
            <UserPlus className="w-3 h-3" /> Added by {intake.created_by_name}
          </div>
        )}
      </div>

      {/* Footer: days in pipeline + navigation */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-color)]">
        <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
          <Clock className="w-3 h-3" />
          {days === 0 ? 'Today' : `${days}d ago`}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
            className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 transition-colors"
            title="Delete prospect"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {!isFirst && (
            <button
              onClick={onMoveBack}
              disabled={isUpdating}
              className="p-1 rounded-md hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] disabled:opacity-40 transition-colors"
              title="Move to previous stage"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}
          {!isLast && (
            <button
              onClick={onMoveForward}
              disabled={isUpdating}
              className="p-1 rounded-md hover:bg-[var(--bg-secondary)] text-[var(--text-muted)] disabled:opacity-40 transition-colors"
              title="Move to next stage"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
