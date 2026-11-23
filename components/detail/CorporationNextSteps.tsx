'use client';

import { useRef, useState } from 'react';
import { Check, Circle, Upload, ArrowRight, Stamp, PartyPopper } from 'lucide-react';
import { buildLifecyclePlan, type StageItem } from '@/lib/corporations/stages';
import { useFileDrop } from '@/hooks/use-file-drop';
import type { Corporation, CorporationFile, CorporationPerson } from '@/types/corporations';

const COLLAPSED_COUNT = 3;

interface Props {
  corporation: Corporation;
  files: CorporationFile[];
  people: CorporationPerson[];
  /** Uploads a file against a document item. Resolves when the row is recorded. */
  onUpload: (item: StageItem, file: File) => Promise<void>;
  onGoToTab: (tab: 'overview' | 'people' | 'registrations', field?: string) => void;
  onRecordRegistration: () => void;
  /** Render nothing, rather than the all-done banner, once the checklist is finished. */
  hideWhenComplete?: boolean;
}

/**
 * What to do next, derived rather than tracked.
 *
 * The registry knows the lifecycle state and knows exactly which facts are
 * missing; before this card that knowledge only coloured the status pill, and
 * the user had to already know the workflow to follow it across ten tabs. Each
 * outstanding item here is an action, not a description — and because document
 * items run through the extractor, uploading the certificate is usually the
 * whole step.
 */
export default function CorporationNextSteps({
  corporation,
  files,
  people,
  onUpload,
  onGoToTab,
  onRecordRegistration,
  hideWhenComplete = false,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const pending = useRef<StageItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const plan = buildLifecyclePlan({ corporation, files, people });
  const { currentStage } = plan;

  async function pick(item: StageItem) {
    pending.current = item;
    inputRef.current?.click();
  }

  async function onDropForItem(item: StageItem, list: File[]) {
    if (item.action.kind !== 'upload' || !list.length) return;
    setBusy(item.key);
    try {
      for (const f of list) await onUpload(item, f);
    } finally {
      setBusy(null);
    }
  }

  async function onFileChosen(file: File | undefined) {
    const item = pending.current;
    pending.current = null;
    if (inputRef.current) inputRef.current.value = '';
    if (!item || !file) return;
    setBusy(item.key);
    try {
      await onUpload(item, file);
    } finally {
      setBusy(null);
    }
  }

  if (plan.stages.length === 0) return null;

  if (!currentStage) {
    if (hideWhenComplete) return null;
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10">
        <PartyPopper className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <p className="text-sm text-emerald-900 dark:text-emerald-300">
          Everything on the setup checklist is done. Ongoing compliance is tracked under Compliance.
        </p>
      </div>
    );
  }

  const outstanding = currentStage.items.filter((i) => !i.done);
  const doneCount = currentStage.items.length - outstanding.length;
  // A long stage (post-incorporation has thirteen items) would otherwise push
  // the tabs below the fold; the first few outstanding items are the next steps.
  const visible = showAll ? currentStage.items : outstanding.slice(0, COLLAPSED_COUNT);
  const hidden = currentStage.items.length - visible.length;

  return (
    <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl px-5 py-4">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => void onFileChosen(e.target.files?.[0])}
      />

      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">Next steps</h3>
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {currentStage.label} · {doneCount} of {currentStage.items.length} done
          </span>
          <span className="hidden sm:block w-24 h-1.5 rounded-full bg-stone-100 dark:bg-white/10 overflow-hidden" aria-hidden>
            <span
              className="block h-full bg-emerald-500"
              style={{ width: `${Math.round((doneCount / currentStage.items.length) * 100)}%` }}
            />
          </span>
        </div>
        {(hidden > 0 || showAll) && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
          >
            {showAll ? 'Show less' : `Show all ${currentStage.items.length}`}
          </button>
        )}
      </div>

      <ul className="space-y-1">
        {visible.map((item) => (
          <ChecklistRow
            key={item.key}
            item={item}
            busy={busy === item.key}
            onDropFiles={(list) => void onDropForItem(item, list)}
            onPick={pick}
            onGoToTab={onGoToTab}
            onRecordRegistration={onRecordRegistration}
          />
        ))}
      </ul>

      {!showAll && outstanding.length > visible.length && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-1 text-xs text-navy-700 dark:text-navy-300 hover:underline"
        >
          + {outstanding.length - visible.length} more to do
        </button>
      )}

      {outstanding.length === 0 && !showAll && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {currentStage.label} is complete — the next stage opens up from here.
        </p>
      )}
    </section>
  );
}

function ItemAction({
  item,
  busy,
  onPick,
  onGoToTab,
  onRecordRegistration,
}: {
  item: StageItem;
  busy: boolean;
  onPick: (item: StageItem) => void;
  onGoToTab: (tab: 'overview' | 'people' | 'registrations', field?: string) => void;
  onRecordRegistration: () => void;
}) {
  const cls =
    'shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-stone-300 dark:border-white/15 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5 disabled:opacity-50';

  if (item.action.kind === 'upload') {
    return (
      <button onClick={() => onPick(item)} disabled={busy} className={cls}>
        <Upload className="w-3 h-3" />
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    );
  }

  if (item.action.kind === 'record_registration') {
    return (
      <button onClick={onRecordRegistration} className={cls}>
        <Stamp className="w-3 h-3" />
        Record details
      </button>
    );
  }

  const { tab, field } = item.action;
  return (
    <button onClick={() => onGoToTab(tab, field)} className={cls}>
      <ArrowRight className="w-3 h-3" />
      Fill in
    </button>
  );
}

/**
 * A checklist line. Items whose action is an upload double as drop targets, so
 * the certificate can go straight onto the step it satisfies.
 */
function ChecklistRow({
  item,
  busy,
  onDropFiles,
  onPick,
  onGoToTab,
  onRecordRegistration,
}: {
  item: StageItem;
  busy: boolean;
  onDropFiles: (files: File[]) => void;
  onPick: (item: StageItem) => void;
  onGoToTab: (tab: 'overview' | 'people' | 'registrations', field?: string) => void;
  onRecordRegistration: () => void;
}) {
  const droppable = !item.done && item.action.kind === 'upload';
  const { isOver, dropProps } = useFileDrop(onDropFiles, { disabled: !droppable || busy });

  return (
    <li
      {...(droppable ? dropProps : {})}
      className={`flex items-start gap-2.5 py-1.5 px-2 -mx-2 rounded-lg transition-colors ${
        item.done ? 'opacity-55' : ''
      } ${isOver ? 'bg-navy-50 dark:bg-navy-500/10 ring-1 ring-navy-300 dark:ring-navy-500/40 ring-dashed' : ''}`}
    >
      {item.done ? (
        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
      ) : (
        <Circle className="w-3.5 h-3.5 text-stone-300 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${item.done ? 'text-stone-500 dark:text-stone-400 line-through' : 'text-stone-800 dark:text-stone-100'}`}>
          {item.label}
          {isOver && <span className="ml-2 text-[11px] text-navy-700 dark:text-navy-300">Drop to upload</span>}
        </p>
        {!item.done && item.detail && <p className="text-[11px] text-stone-500 dark:text-stone-400">{item.detail}</p>}
      </div>
      {!item.done && (
        <ItemAction
          item={item}
          busy={busy}
          onPick={onPick}
          onGoToTab={onGoToTab}
          onRecordRegistration={onRecordRegistration}
        />
      )}
    </li>
  );
}
