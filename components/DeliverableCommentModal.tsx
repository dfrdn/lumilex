'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, MessageSquare, Upload, FileText, Paperclip, AtSign, Loader2, User, Users, RotateCcw, Send, SkipForward,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

// ── Types ───────────────────────────────────────────────────────

export interface TeamMember {
  personId: string;
  name: string;
  initials: string;
}

export type RevertTarget = 'drafter' | 'initial';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { comment: string; mentions: string[]; files?: File[]; revertTarget?: RevertTarget; reviewTargetChoice?: number }) => Promise<void>;
  actionLabel: string;
  deliverableName: string;
  loading: boolean;
  teamMembers: TeamMember[];
  /** When true, show a "Revert to" picker (Drafter vs Initial Reviewer) */
  showRevertTarget?: boolean;
  /** Person IDs of the drafter(s) — used to show names in the revert picker */
  drafterIds?: string[];
  /** Ordered reviewer IDs — first is initial, last is final */
  reviewerIds?: string[];
  /** Index into reviewerIds — show a read-only indicator for who the review is submitted to */
  reviewTargetIndex?: number;
  /** When true, show a picker to choose which reviewer to submit to */
  showReviewTargetPicker?: boolean;
  /** Starting index in reviewerIds for picker options (default 0 = show all reviewers) */
  reviewTargetPickerStartIndex?: number;
}

// ── Component ───────────────────────────────────────────────────

export default function DeliverableCommentModal({
  open,
  onClose,
  onSubmit,
  actionLabel,
  deliverableName,
  loading,
  teamMembers,
  showRevertTarget = false,
  drafterIds = [],
  reviewerIds = [],
  reviewTargetIndex,
  showReviewTargetPicker = false,
  reviewTargetPickerStartIndex = 0,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [mentions, setMentions] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => { setMounted(true); }, []);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [revertTarget, setRevertTarget] = useState<RevertTarget>('drafter');
  const [reviewTargetChoice, setReviewTargetChoice] = useState<number>(reviewTargetIndex ?? 0);
  const [confirmSubmit, setConfirmSubmit] = useState<{ title: string; message: string } | null>(null);

  // Reset review target choice when the modal opens with a new action
  useEffect(() => {
    if (open && reviewTargetIndex !== undefined) {
      setReviewTargetChoice(reviewTargetIndex);
    }
  }, [open, reviewTargetIndex]);

  const editorRef = useRef<HTMLDivElement>(null);

  const mentionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Helpers: extract text & mentions from contentEditable ──────
  const getEditorContent = useCallback(() => {
    const el = editorRef.current;
    if (!el) return { text: '', mentionIds: [] as string[] };

    const mentionIds: string[] = [];
    let text = '';

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || '';
      } else if (node instanceof HTMLElement) {
        const mid = node.getAttribute('data-mention-id');
        if (mid) {
          mentionIds.push(mid);
          text += node.textContent || '';
        } else if (node.tagName === 'BR') {
          text += '\n';
        } else {
          node.childNodes.forEach(walk);
        }
      }
    };
    el.childNodes.forEach(walk);
    return { text, mentionIds };
  }, []);

  const isEditorEmpty = useCallback(() => {
    const el = editorRef.current;
    if (!el) return true;
    return el.textContent?.trim() === '';
  }, []);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      if (editorRef.current) editorRef.current.innerHTML = '';
      setMentions([]);
      setFiles([]);
      setShowMentionDropdown(false);
      setMentionQuery('');
      setHighlightedIndex(0);
      setDragOver(false);
      setRevertTarget('drafter');
      requestAnimationFrame(() => editorRef.current?.focus());
    }
  }, [open]);

  // Close mention dropdown on outside click
  useEffect(() => {
    if (!showMentionDropdown) return;
    function handleClick(e: MouseEvent) {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) {
        setShowMentionDropdown(false);
        setMentionQuery('');
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [showMentionDropdown]);

  // Focus editor on open
  useEffect(() => {
    if (open && editorRef.current) {
      setTimeout(() => editorRef.current?.focus(), 100);
    }
  }, [open]);

  // Close on Escape (only when dropdown is not open)
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading && !showMentionDropdown) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, loading, onClose, showMentionDropdown]);

  // Filtered team members for mention dropdown
  const filteredMembers = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    return teamMembers
      .filter((m) => !mentions.includes(m.personId))
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.initials.toLowerCase().includes(q));
  }, [teamMembers, mentionQuery, mentions]);

  // Reset highlighted index when filtered list changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredMembers.length, mentionQuery]);


  // ── Mention selection ───────────────────────────────────────────
  const handleSelectMention = useCallback(
    (member: TeamMember) => {
      const el = editorRef.current;
      if (!el) return;

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      // Find the @ trigger text node and remove it + query text
      const range = sel.getRangeAt(0);
      const textNode = range.startContainer;
      if (textNode.nodeType !== Node.TEXT_NODE) return;

      const text = textNode.textContent || '';
      const cursorOffset = range.startOffset;
      const textBefore = text.slice(0, cursorOffset);
      const lastAt = textBefore.lastIndexOf('@');
      if (lastAt < 0) return;

      const textAfter = text.slice(cursorOffset);
      const textBeforeAt = text.slice(0, lastAt);

      // Create mention span
      const mentionSpan = document.createElement('span');
      mentionSpan.setAttribute('data-mention-id', member.personId);
      mentionSpan.setAttribute('contenteditable', 'false');
      mentionSpan.className = 'inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 text-[11px] font-semibold text-blue-700 bg-blue-100 rounded-md align-baseline select-all dark:bg-blue-500/20 dark:text-blue-300';
      mentionSpan.textContent = `@${member.name}`;

      // Replace text node with: textBeforeAt + mentionSpan + space + textAfter
      const parent = textNode.parentNode!;
      const beforeNode = document.createTextNode(textBeforeAt);
      const afterNode = document.createTextNode('\u00A0' + textAfter);

      parent.insertBefore(beforeNode, textNode);
      parent.insertBefore(mentionSpan, textNode);
      parent.insertBefore(afterNode, textNode);
      parent.removeChild(textNode);

      // Place cursor after the space
      const newRange = document.createRange();
      newRange.setStart(afterNode, 1);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);

      setMentions((prev) => [...prev, member.personId]);
      setShowMentionDropdown(false);
      setMentionQuery('');
      setHighlightedIndex(0);
    },
    [],
  );

  // ── Editor input handler with @ detection ─────────────────────
  const handleEditorInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    // Sync mentions state with what's actually in the DOM
    const { mentionIds } = getEditorContent();
    setMentions(mentionIds);

    // Detect @ trigger from current cursor position
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      setShowMentionDropdown(false);
      return;
    }

    const range = sel.getRangeAt(0);
    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) {
      setShowMentionDropdown(false);
      setMentionQuery('');
      return;
    }

    const text = textNode.textContent || '';
    const cursorOffset = range.startOffset;
    const textBefore = text.slice(0, cursorOffset);
    const lastAt = textBefore.lastIndexOf('@');

    if (
      lastAt >= 0 &&
      (lastAt === 0 || textBefore[lastAt - 1] === ' ' || textBefore[lastAt - 1] === '\n' || textBefore[lastAt - 1] === '\u00A0')
    ) {
      const query = textBefore.slice(lastAt + 1);
      if (!query.includes(' ') && !query.includes('\n') && !query.includes('\u00A0')) {
        setShowMentionDropdown(true);
        setMentionQuery(query);
        return;
      }
    }
    setShowMentionDropdown(false);
    setMentionQuery('');
  }, [getEditorContent]);

  // ── Keyboard navigation for mention dropdown + Enter handling ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (showMentionDropdown && filteredMembers.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev + 1) % filteredMembers.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlightedIndex((prev) => (prev - 1 + filteredMembers.length) % filteredMembers.length);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          handleSelectMention(filteredMembers[highlightedIndex]);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setShowMentionDropdown(false);
          setMentionQuery('');
        }
        return;
      }

      // Insert <br> on Enter to prevent browser from inserting <div> blocks
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const br = document.createElement('br');
          range.insertNode(br);
          // Move cursor after the <br>
          range.setStartAfter(br);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    },
    [showMentionDropdown, filteredMembers, highlightedIndex, handleSelectMention],
  );

  // ── File handling ──────────────────────────────────────────────
  const handleFilesSelect = useCallback((newFiles: FileList | File[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const unique = Array.from(newFiles).filter((f) => !existing.has(`${f.name}-${f.size}`));
      return [...prev, ...unique];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) handleFilesSelect(e.dataTransfer.files);
    },
    [handleFilesSelect],
  );

  const doSubmit = useCallback(async () => {
    const { text, mentionIds } = getEditorContent();
    await onSubmit({
      comment: text.trim(),
      mentions: mentionIds,
      files: files.length > 0 ? files : undefined,
      revertTarget: showRevertTarget ? revertTarget : undefined,
      reviewTargetChoice: showReviewTargetPicker ? reviewTargetChoice : undefined,
    });
  }, [getEditorContent, files, onSubmit, showRevertTarget, revertTarget, showReviewTargetPicker, reviewTargetChoice]);

  const handleSubmit = useCallback(async () => {
    const { text } = getEditorContent();
    const hasComment = text.trim().length > 0;
    const hasFiles = files.length > 0;

    if (!hasComment && !hasFiles) {
      setConfirmSubmit({ title: 'Continue without comment and file?', message: 'You haven\'t added a comment or attached a file. The action will be logged without either.' });
    } else if (!hasComment) {
      setConfirmSubmit({ title: 'Continue without comment?', message: 'You haven\'t added a comment. The action will be logged without one.' });
    } else if (!hasFiles) {
      setConfirmSubmit({ title: 'Continue without file?', message: 'You haven\'t attached a file. The action will be logged without one.' });
    } else {
      await doSubmit();
    }
  }, [getEditorContent, files, doSubmit]);

  // Early-return AFTER all hooks
  if (!open || !mounted) return null;

  return (<>
    {createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay"
        onClick={loading ? undefined : onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl shadow-stone-900/10 border border-stone-200/60 w-full max-w-lg overflow-hidden animate-dialog dark:bg-stone-900 dark:border-stone-700/60">
        {/* Gradient accent */}
        <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

        {/* Header */}
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                <MessageSquare className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{actionLabel}</h3>
                <p className="text-xs text-stone-400 mt-0.5 truncate max-w-[280px] dark:text-stone-500">{deliverableName}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={loading ? undefined : onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors cursor-pointer dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Comment textarea with @mention */}
          <div className="relative" ref={mentionRef}>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
              <MessageSquare className="w-3 h-3" />
              Comment
              <span className="font-normal normal-case tracking-normal">(optional)</span>
            </label>

            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
            <div
              ref={editorRef}
              contentEditable={!loading}
              suppressContentEditableWarning
              onInput={handleEditorInput}
              onKeyDown={handleKeyDown}
              onPaste={(e) => {
                e.preventDefault();
                const text = e.clipboardData.getData('text/plain');
                document.execCommand('insertText', false, text);
              }}
              data-placeholder="Add a comment (optional)... Use @ to mention team members"
              className="w-full min-h-[6rem] max-h-48 overflow-y-auto px-3 py-2.5 text-sm text-stone-800 bg-white border border-stone-200 rounded-lg outline-none transition-all duration-150 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 empty:before:content-[attr(data-placeholder)] empty:before:text-stone-400 empty:before:pointer-events-none [&[contenteditable=false]]:opacity-50 dark:bg-stone-900 dark:border-stone-700 dark:text-stone-100"
            />

            {/* @mention dropdown */}
            {showMentionDropdown && filteredMembers.length > 0 && (
              <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg shadow-stone-900/5 overflow-hidden animate-fade-down dark:bg-stone-900 dark:border-stone-700">
                <div className="px-3 py-1.5 border-b border-stone-100 flex items-center gap-1.5 dark:border-stone-800">
                  <AtSign className="w-3 h-3 text-blue-500" />
                  <span className="text-[11px] font-medium text-stone-400 dark:text-stone-500">Mention a team member</span>
                </div>
                <div className="max-h-36 overflow-y-auto py-0.5">
                  {filteredMembers.map((m, i) => (
                    <button
                      key={m.personId}
                      type="button"
                      onClick={() => handleSelectMention(m)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors duration-75 cursor-pointer text-left ${
                        i === highlightedIndex
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'
                          : 'text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800'
                      }`}
                    >
                      <span
                        className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0 ${
                          i === highlightedIndex ? 'bg-blue-200 text-blue-800' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                        }`}
                      >
                        {m.initials}
                      </span>
                      <span>{m.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Revert target picker */}
          {showRevertTarget && (() => {
            const drafterNames = drafterIds
              .map((id) => teamMembers.find((m) => m.personId === id)?.name)
              .filter(Boolean) as string[];
            const initialReviewerId = reviewerIds[0] ?? null;
            const initialReviewerName = initialReviewerId
              ? teamMembers.find((m) => m.personId === initialReviewerId)?.name
              : null;
            const drafterLabel = drafterNames.length > 1 ? 'Drafters' : 'Drafter';

            return (
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                  <RotateCcw className="w-3 h-3" />
                  Revert to
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRevertTarget('drafter')}
                    disabled={loading}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all duration-150 cursor-pointer text-left ${
                      revertTarget === 'drafter'
                        ? 'border-gold-400 bg-gold-50 ring-2 ring-gold-400/20 dark:bg-gold-500/10'
                        : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'
                    }`}
                  >
                    <div className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 ${
                      revertTarget === 'drafter' ? 'bg-gold-200 text-gold-700 dark:text-gold-300' : 'bg-stone-200 text-stone-500 dark:bg-stone-700 dark:text-stone-400'
                    }`}>
                      {drafterNames.length > 1
                        ? <Users className="w-3.5 h-3.5" />
                        : <User className="w-3.5 h-3.5" />}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold ${
                        revertTarget === 'drafter' ? 'text-gold-800' : 'text-stone-600 dark:text-stone-300'
                      }`}>{drafterLabel}</p>
                      {drafterNames.length > 0 && (
                        <p className={`text-[10px] truncate ${
                          revertTarget === 'drafter' ? 'text-gold-600 dark:text-gold-400' : 'text-stone-400 dark:text-stone-500'
                        }`}>{drafterNames.join(', ')}</p>
                      )}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRevertTarget('initial')}
                    disabled={loading}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border transition-all duration-150 cursor-pointer text-left ${
                      revertTarget === 'initial'
                        ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-400/20 dark:bg-blue-500/10'
                        : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'
                    }`}
                  >
                    <div className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 ${
                      revertTarget === 'initial' ? 'bg-blue-200 text-blue-700 dark:text-blue-300' : 'bg-stone-200 text-stone-500 dark:bg-stone-700 dark:text-stone-400'
                    }`}>
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-semibold ${
                        revertTarget === 'initial' ? 'text-blue-800' : 'text-stone-600 dark:text-stone-300'
                      }`}>Initial Reviewer</p>
                      {initialReviewerName && (
                        <p className={`text-[10px] truncate ${
                          revertTarget === 'initial' ? 'text-blue-600 dark:text-blue-400' : 'text-stone-400 dark:text-stone-500'
                        }`}>{initialReviewerName}</p>
                      )}
                    </div>
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Review target picker (selectable) — default on own row, others share a row */}
          {showReviewTargetPicker && (() => {
            const ROLE_LABELS = ['Initial Reviewer', 'Second Reviewer', 'Third Reviewer', 'Fourth Reviewer'];
            const getLabel = (i: number, total: number) => {
              if (i === total - 1 && total > 1) return 'Final Reviewer';
              return ROLE_LABELS[i] || `Reviewer ${i + 1}`;
            };

            const pickerOptions = reviewerIds
              .map((rid, idx) => ({ rid, idx }))
              .filter(({ idx }) => idx >= reviewTargetPickerStartIndex);
            const defaultOption = pickerOptions[0];
            const otherOptions = pickerOptions.slice(1);

            const renderOption = (rid: string, idx: number, compact = false) => {
              const name = teamMembers.find((m) => m.personId === rid)?.name;
              const isSelected = reviewTargetChoice === idx;
              return (
                <button
                  key={rid}
                  type="button"
                  onClick={() => setReviewTargetChoice(idx)}
                  disabled={loading}
                  className={`w-full flex items-center gap-2.5 rounded-lg border transition-all duration-150 cursor-pointer text-left ${
                    compact ? 'px-2.5 py-2' : 'px-3 py-2.5'
                  } ${
                    isSelected
                      ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-400/20 dark:bg-emerald-500/10'
                      : 'border-stone-200 bg-stone-50/80 hover:border-stone-300 dark:bg-stone-800 dark:border-stone-700 dark:hover:border-stone-600'
                  }`}
                >
                  <div className={`flex items-center justify-center rounded-lg shrink-0 ${
                    compact ? 'w-6 h-6' : 'w-7 h-7'
                  } ${
                    isSelected ? 'bg-emerald-200 text-emerald-700 dark:text-emerald-300' : 'bg-stone-200 text-stone-500 dark:bg-stone-700 dark:text-stone-400'
                  }`}>
                    <User className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
                  </div>
                  <div className="min-w-0">
                    <p className={`font-semibold ${
                      compact ? 'text-[11px]' : 'text-xs'
                    } ${
                      isSelected ? 'text-emerald-800' : 'text-stone-600 dark:text-stone-300'
                    }`}>{getLabel(idx, reviewerIds.length)}</p>
                    {name && (
                      <p className={`truncate ${
                        compact ? 'text-[9px]' : 'text-[10px]'
                      } ${
                        isSelected ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400 dark:text-stone-500'
                      }`}>{name}</p>
                    )}
                  </div>
                </button>
              );
            };

            return (
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                  <Send className="w-3 h-3" />
                  Submit to
                </label>
                <div className="space-y-2">
                  {/* Default reviewer — full-width, emphasized */}
                  {defaultOption && renderOption(defaultOption.rid, defaultOption.idx)}
                  {/* Other reviewers — compact, with skip hint */}
                  {otherOptions.length > 0 && (
                    <div>
                      <p className="flex items-center gap-1 text-[10px] text-stone-400 mb-1.5 dark:text-stone-500">
                        <SkipForward className="w-3 h-3" />
                        Or skip ahead
                      </p>
                      <div className={`grid gap-2 ${otherOptions.length === 1 ? 'grid-cols-1' : otherOptions.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                        {otherOptions.map(({ rid, idx }) => renderOption(rid, idx, true))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Review target indicator (read-only) — shown when there's a fixed target and no picker */}
          {reviewTargetIndex !== undefined && !showReviewTargetPicker && (() => {
            const targetId = reviewerIds[reviewTargetIndex] ?? null;
            const targetName = targetId
              ? teamMembers.find((m) => m.personId === targetId)?.name
              : null;
            const ROLE_LABELS = ['Initial Reviewer', 'Second Reviewer', 'Third Reviewer', 'Fourth Reviewer'];
            const getLabel = (i: number, total: number) => {
              if (i === total - 1 && total > 1) return 'Final Reviewer';
              return ROLE_LABELS[i] || `Reviewer ${i + 1}`;
            };
            const roleLabel = getLabel(reviewTargetIndex, reviewerIds.length);

            return (
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
                  <Send className="w-3 h-3" />
                  Submit to
                </label>
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-emerald-400 bg-emerald-50 ring-2 ring-emerald-400/20 dark:bg-emerald-500/10">
                  <div className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 bg-emerald-200 text-emerald-700 dark:text-emerald-300">
                    <User className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-emerald-800">{roleLabel}</p>
                    {targetName && (
                      <p className="text-[10px] truncate text-emerald-600 dark:text-emerald-400">{targetName}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* File upload zone */}
          <div>
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
              <Paperclip className="w-3 h-3" />
              Attachment
              <span className="font-normal normal-case tracking-normal">(optional)</span>
            </label>

            {/* Selected files list */}
            {files.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {files.map((f, i) => (
                  <div key={`${f.name}-${f.size}`} className="flex items-center gap-3 px-3 py-2 bg-blue-50/60 border border-blue-200/60 rounded-lg">
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-100 text-blue-600 shrink-0 dark:bg-blue-500/20 dark:text-blue-400">
                      <FileText className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate dark:text-stone-100">{f.name}</p>
                      <p className="text-xs text-stone-400 dark:text-stone-500">
                        {f.size < 1024 * 1024
                          ? `${(f.size / 1024).toFixed(1)} KB`
                          : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      disabled={loading}
                      className="p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50 dark:text-stone-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Drop zone (always visible to allow adding more files) */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 ${files.length > 0 ? 'py-3' : 'py-5'} px-4 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-150 ${
                dragOver
                  ? 'border-blue-400 bg-blue-50/50'
                  : 'border-stone-200 bg-stone-50/50 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800 dark:hover:border-stone-600'
              }`}
            >
              <div
                className={`p-2 rounded-full transition-colors ${
                  dragOver ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400' : 'bg-stone-100 text-stone-400 dark:bg-stone-700 dark:text-stone-500'
                }`}
              >
                <Upload className="w-4 h-4" />
              </div>
              <div className="text-center">
                <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  {files.length > 0 ? 'Add more files' : 'Drop files here or'}{' '}
                  <span className="text-blue-600 dark:text-blue-400">browse</span>
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                const picked = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = '';
                if (picked.length > 0) handleFilesSelect(picked);
              }}
            />
          </div>

          {/* Divider */}
          <div className="border-t border-stone-100 dark:border-stone-800" />

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-xl transition-colors duration-150 cursor-pointer disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </span>
              ) : (
                `Submit & ${actionLabel}`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )}
    <ConfirmDialog
      open={!!confirmSubmit}
      title={confirmSubmit?.title ?? ''}
      message={confirmSubmit?.message ?? ''}
      confirmLabel="Submit Anyway"
      variant="primary"
      loading={loading}
      onConfirm={async () => {
        setConfirmSubmit(null);
        await doSubmit();
      }}
      onCancel={() => setConfirmSubmit(null)}
    />
  </>);
}
