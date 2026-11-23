'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  FileText, Upload, MessageSquare, Clock,
  Download, Eye, ChevronDown, ChevronRight, ArrowUpRight, Files,
  Pencil, Trash2, X, Check, Loader2, RefreshCw, Plus,
  Reply,
} from 'lucide-react';
import type { DeliverableFileVersion, DeliverableActionLog, DeliverableComment } from '@/types/notion';
import type { PersonInfo, TeamMemberOption } from '@/lib/queries/people';
import Avatar from '@/components/Avatar';
import FilePreviewModal from '@/components/FilePreviewModal';
import NeedsReuploadBadge from './NeedsReuploadBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import MentionEditor, { type MentionEditorHandle } from '@/components/detail/MentionEditor';
import { commitUpload, uploadToSignedUrl } from '@/lib/upload';
import { downloadFile } from '@/lib/download-file';
import CommentReactions from '@/components/detail/CommentReactions';
import VersionReactions from '@/components/detail/VersionReactions';
import { toast } from 'sonner';

/** A grouped submission (one or more files sharing the same version number) */
type VersionGroup = {
  version: number;
  files: DeliverableFileVersion[];
  uploadedBy: string;
  action: string | null;
  createdAt: string;
};

/** A version with its associated actions and standalone comments */
type VersionSection = {
  version: VersionGroup;
  actions: DeliverableActionLog[];
  standaloneComments: DeliverableComment[];
  /** Files carried over from previous versions that weren't replaced in this version */
  carriedOverFiles: DeliverableFileVersion[];
};

interface Props {
  versions: DeliverableFileVersion[];
  actions: DeliverableActionLog[];
  comments?: DeliverableComment[];
  versionReactions?: Record<number, import('@/types/notion').CommentReaction[]>;
  people: Record<string, PersonInfo>;
  teamMembers?: TeamMemberOption[];
  currentUserId?: string;
  deliverableId?: string;
  currentStatus?: string;
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function getActionColor(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('submit') || a.includes('finalize') || a.includes('pre-finalize')) return 'bg-emerald-500 dark:bg-emerald-400';
  if (a.includes('review') || a.includes('for review')) return 'bg-violet-500 dark:bg-violet-400';
  if (a.includes('revis') || a.includes('revert')) return 'bg-amber-500 dark:bg-amber-400';
  if (a.includes('draft') || a.includes('start')) return 'bg-sky-500 dark:bg-sky-400';
  if (a.includes('filed') || a.includes('sent')) return 'bg-emerald-600 dark:bg-emerald-500';
  if (a.includes('await')) return 'bg-orange-500 dark:bg-orange-400';
  return 'bg-navy-400 dark:bg-navy-500';
}

/** Edit-trail actions (file replacements, comment edits, label edits) that
 *  should collapse into an "edited" indicator instead of cluttering the feed. */
function isEditAction(action: string): boolean {
  const a = action.toLowerCase();
  return a.startsWith('edited ') || a.startsWith('added files to ');
}

/** Render comment text with inline mention highlights */
function renderCommentText(text: string, mentionIds: string[], people: Record<string, PersonInfo>) {
  if (!mentionIds.length) return <span>{text}</span>;
  const mentionNames = new Map<string, string>();
  for (const id of mentionIds) {
    const p = people[id];
    if (p) mentionNames.set(`@${p.initials}`, id);
  }
  return <span>{text}</span>;
}

/** Try to parse a version number from an action string like "Edited submission v2" */
function parseVersionFromAction(action: string): number | null {
  const match = action.match(/\bv(\d+)\b/i);
  return match ? parseInt(match[1], 10) : null;
}

/** Normalize a filename into extension + token set for fuzzy matching.
 *  Strips punctuation/brackets/reviewer-initial markup so e.g. "Draft (mno).docx"
 *  and "Draft_(mno)(qzx).docx" share most of their tokens. */
function normalizeFilename(name: string): { tokens: Set<string>; ext: string } {
  const dotIdx = name.lastIndexOf('.');
  const ext = dotIdx >= 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
  const base = dotIdx >= 0 ? name.slice(0, dotIdx) : name;
  const tokens = new Set(
    base.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean),
  );
  return { tokens, ext };
}

/** Jaccard similarity over token sets. 0 when either set is empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Minimum Jaccard score on tokenized filenames to treat two files as the
 *  "same document". 0.6 accepts reviewer-initial additions (e.g. adding "qzx"
 *  to a 7-token base) and underscore/space variants, while rejecting
 *  unrelated docs that only share one or two common words. */
const FILENAME_MATCH_THRESHOLD = 0.6;

/** Find the most recent version whose createdAt <= the given date */
function findVersionByTimestamp(date: string, versionGroups: VersionGroup[]): number | null {
  const t = new Date(date).getTime();
  // versionGroups should be sorted ascending by createdAt for this
  let best: VersionGroup | null = null;
  for (const g of versionGroups) {
    if (new Date(g.createdAt).getTime() <= t) {
      best = g;
    }
  }
  return best?.version ?? null;
}

export default function DeliverableVersionHistory({
  versions: versionsProp, actions: actionsProp, comments: commentsProp = [], versionReactions = {}, people, teamMembers = [], currentUserId, deliverableId,
}: Props) {
  // Local mirrors so edits/deletes/uploads update the UI without a full page
  // refresh. Each useEffect re-syncs from the server-rendered prop on
  // navigation back to this view.
  const [versions, setVersions] = useState(versionsProp);
  useEffect(() => { setVersions(versionsProp); }, [versionsProp]);
  const [actions, setActions] = useState(actionsProp);
  useEffect(() => { setActions(actionsProp); }, [actionsProp]);
  const [comments, setComments] = useState<DeliverableComment[]>(commentsProp);
  useEffect(() => { setComments(commentsProp); }, [commentsProp]);
  const [showAll, setShowAll] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string } | null>(null);

  // Edit state
  const [editingVersionNum, setEditingVersionNum] = useState<number | null>(null);
  const [editAction, setEditAction] = useState('');
  const [editReplacements, setEditReplacements] = useState<Record<number, File>>({}); // fileId -> replacement
  const [editAddFiles, setEditAddFiles] = useState<File[]>([]);
  const [editLoading, setEditLoading] = useState(false);

  // Action edit state
  const [editingActionId, setEditingActionId] = useState<number | null>(null);
  const [editActionInitial, setEditActionInitial] = useState<{ text: string; mentionIds: string[] }>({ text: '', mentionIds: [] });
  const [editActionFile, setEditActionFile] = useState<File | null>(null);
  const [editActionLoading, setEditActionLoading] = useState(false);
  const editActionEditorRef = useRef<MentionEditorHandle>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<{ id?: number; version?: number; deliverableId?: string; label: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Reply state — only version replies now
  const [replyTarget, setReplyTarget] = useState<{ parentType: 'version'; parentId: number } | null>(null);
  const [replyLoading, setReplyLoading] = useState(false);

  // Standalone comment loading
  const [commentLoading, setCommentLoading] = useState(false);

  // Comment edit/delete state
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [deleteCommentTarget, setDeleteCommentTarget] = useState<{ id: number; label: string } | null>(null);

  // Collapse state for older versions
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());

  // Which version's edit history popover is open
  const [expandedEditHistory, setExpandedEditHistory] = useState<Set<number>>(new Set());
  const toggleEditHistory = useCallback((version: number) => {
    setExpandedEditHistory((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }, []);

  // Which version's actions list is expanded inline (workflow actions only).
  const [expandedActions, setExpandedActions] = useState<Set<number>>(new Set());
  const toggleExpandedActions = useCallback((version: number) => {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }, []);

  const toggleVersionExpanded = useCallback((version: number) => {
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }, []);

  const startEditingComment = useCallback((comment: DeliverableComment) => {
    setEditingCommentId(comment.id);
    setEditCommentText(comment.comment);
  }, []);

  const cancelEditingComment = useCallback(() => {
    setEditingCommentId(null);
    setEditCommentText('');
  }, []);

  const handleSaveCommentEdit = useCallback(async () => {
    if (editingCommentId === null || !editCommentText.trim()) return;
    const id = editingCommentId;
    const newText = editCommentText;
    let previous: DeliverableComment | undefined;
    setComments((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      previous = c;
      return { ...c, comment: newText };
    }));
    cancelEditingComment();
    try {
      const res = await fetch('/api/deliverable-comment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, comment: newText }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Edit failed' }));
        throw new Error(err.error);
      }
    } catch (err) {
      if (previous) {
        const restore = previous;
        setComments((prev) => prev.map((c) => (c.id === id ? restore : c)));
      }
      toast.error(err instanceof Error ? err.message : 'Edit failed');
    }
  }, [editingCommentId, editCommentText, cancelEditingComment]);

  const handleDeleteComment = useCallback(async () => {
    if (!deleteCommentTarget) return;
    const targetId = deleteCommentTarget.id;
    let snapshot: DeliverableComment[] = [];
    setComments((prev) => {
      snapshot = prev;
      return prev.filter((c) => c.id !== targetId);
    });
    setDeleteCommentTarget(null);
    try {
      const res = await fetch('/api/deliverable-comment', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: targetId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Delete failed' }));
        throw new Error(err.error);
      }
    } catch (err) {
      setComments(snapshot);
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [deleteCommentTarget]);

  const startEditing = useCallback((versionGroup: VersionGroup) => {
    setEditingVersionNum(versionGroup.version);
    setEditAction(versionGroup.action || '');
    setEditReplacements({});
    setEditAddFiles([]);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingVersionNum(null);
    setEditAction('');
    setEditReplacements({});
    setEditAddFiles([]);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (editingVersionNum === null) return;
    setEditLoading(true);
    try {
      const replacementEntries = Object.entries(editReplacements);

      // Replace files that have a replacement selected
      for (const [fileIdStr, replFile] of replacementEntries) {
        const fileId = Number(fileIdStr);
        // Phase 1: get signed URL
        const urlRes = await fetch('/api/deliverable-file', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: fileId,
            action: editAction,
            file: { name: replFile.name, size: replFile.size, type: replFile.type },
          }),
        });
        if (!urlRes.ok) {
          const err = await urlRes.json().catch(() => ({ error: 'Edit failed' }));
          throw new Error(err.error);
        }
        const { signedUrl, storagePath } = await urlRes.json();

        // Upload
        await uploadToSignedUrl(signedUrl, replFile, {
          name: replFile.name,
          size: replFile.size,
          type: replFile.type,
        });

        // Phase 2: confirm
        const confirmRes = await fetch('/api/deliverable-file', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: fileId,
            action: editAction,
            confirm: true,
            file: { name: replFile.name, size: replFile.size, storagePath },
          }),
        });
        if (!confirmRes.ok) {
          const err = await confirmRes.json().catch(() => ({ error: 'Confirm failed' }));
          throw new Error(err.error);
        }
      }

      // Update action label if no files were replaced (still save the label change)
      if (replacementEntries.length === 0) {
        // Find the first file in this version to update its action label
        const allVersionFiles = versions.filter((v) => v.version === editingVersionNum);
        if (allVersionFiles.length > 0) {
          const res = await fetch('/api/deliverable-file', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: allVersionFiles[0].id, action: editAction }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Edit failed' }));
            throw new Error(err.error);
          }
        }
      }

      // Add new files to the same version if any were selected
      if (editAddFiles.length > 0 && deliverableId) {
        const addRes = await fetch('/api/deliverable-file/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deliverableId,
            action: editAction || null,
            version: editingVersionNum,
            files: editAddFiles.map((f) => ({ name: f.name, size: f.size, type: f.type })),
          }),
        });
        if (!addRes.ok) {
          const err = await addRes.json().catch(() => ({ error: 'Add files failed' }));
          throw new Error(err.error);
        }
        const { uploads: addUploads, version: addVersion } = await addRes.json();
        for (let i = 0; i < editAddFiles.length; i++) {
          const file = editAddFiles[i];
          const upload = addUploads[i];
          await uploadToSignedUrl(upload.signedUrl, file, {
            name: file.name,
            size: file.size,
            type: file.type,
          });
        }

        // Commit — insert deliverable_files rows only after every PUT succeeded.
        // keepalive + retry so a dropped commit can't strand the uploaded object.
        await commitUpload('/api/deliverable-file/upload-url', {
          confirm: true,
          deliverableId,
          action: editAction || null,
          version: addVersion,
          uploads: editAddFiles.map((f, i) => ({
            storagePath: addUploads[i].storagePath,
            name: f.name,
            size: f.size,
          })),
        });
      }

      // Update the action label across all files in the edited version so
      // the UI reflects the new label without a full page refresh. Replaced
      // file names won't update locally until next nav (the storage path is
      // server-controlled and the original DeliverableFileVersion shape stays).
      if (editAction) {
        setVersions((prev) => prev.map((v) => v.version === editingVersionNum ? { ...v, action: editAction } : v));
      }
      cancelEditing();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Edit failed');
    } finally {
      setEditLoading(false);
    }
  }, [editingVersionNum, editAction, editReplacements, editAddFiles, deliverableId, versions, cancelEditing]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await fetch('/api/deliverable-file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          deleteTarget.id
            ? { id: deleteTarget.id }
            : { version: deleteTarget.version, deliverableId: deleteTarget.deliverableId },
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Delete failed' }));
        throw new Error(err.error);
      }
      if (deleteTarget.id != null) {
        setVersions((prev) => prev.filter((v) => v.id !== deleteTarget.id));
      } else if (deleteTarget.version != null) {
        setVersions((prev) => prev.filter((v) => v.version !== deleteTarget.version));
      }
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget]);

  const startEditingAction = useCallback((action: DeliverableActionLog) => {
    setEditingActionId(action.id);
    setEditActionInitial({ text: action.comment || '', mentionIds: action.mentions || [] });
    setEditActionFile(null);
  }, []);

  const cancelEditingAction = useCallback(() => {
    setEditingActionId(null);
    setEditActionInitial({ text: '', mentionIds: [] });
    setEditActionFile(null);
  }, []);

  const handleSaveActionEdit = useCallback(async () => {
    if (editingActionId === null) return;
    const content = editActionEditorRef.current?.getContent();
    const comment = content?.text ?? '';
    const mentionIds = content?.mentionIds ?? [];
    setEditActionLoading(true);
    try {
      const formData = new FormData();
      formData.append('id', String(editingActionId));
      formData.append('comment', comment);
      const mentionObjs = mentionIds.map((id) => {
        const member = teamMembers.find((m) => m.personId === id);
        return { id, name: member?.name ?? '' };
      });
      formData.append('mentions', JSON.stringify(mentionObjs));
      if (editActionFile) {
        formData.append('file', editActionFile);
      }
      const res = await fetch('/api/deliverable-action', { method: 'PATCH', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Edit failed' }));
        throw new Error(err.error);
      }
      const data = await res.json().catch(() => ({} as { action?: DeliverableActionLog }));
      if (data.action) {
        setActions((prev) => prev.map((a) => a.id === editingActionId ? data.action! : a));
      } else {
        // Best-effort local merge when the server doesn't echo the updated row.
        setActions((prev) => prev.map((a) => a.id === editingActionId ? { ...a, comment, mentions: mentionIds } : a));
      }
      cancelEditingAction();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Edit failed');
    } finally {
      setEditActionLoading(false);
    }
  }, [editingActionId, editActionFile, cancelEditingAction, teamMembers]);

  // Post a comment (standalone or reply to version).
  // Appends to local state on success so the comment appears instantly without
  // the full-page refresh that was making the UI feel unresponsive.
  const postComment = useCallback(async (
    text: string,
    mentionIds: string[],
    parentType?: 'version',
    parentId?: number,
  ) => {
    if (!deliverableId || !currentUserId) return;
    const res = await fetch('/api/deliverable-comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deliverableId,
        comment: text,
        mentions: mentionIds.map((id) => ({ id })),
        parentType: parentType ?? null,
        parentId: parentId ?? null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to post comment' }));
      throw new Error(err.error);
    }
    const { comment: saved } = await res.json();
    // Map the snake_case DB row to the camelCase DeliverableComment shape.
    const newComment: DeliverableComment = {
      id: saved.id,
      deliverableId: saved.deliverable_id,
      parentType: saved.parent_type,
      parentId: saved.parent_id,
      comment: saved.comment,
      mentions: saved.mentions ?? [],
      personId: saved.person_id,
      createdAt: saved.created_at,
      reactions: [],
    };
    setComments((prev) => [...prev, newComment]);
  }, [deliverableId, currentUserId]);

  const handlePostStandaloneComment = useCallback(async (text: string, mentionIds: string[]) => {
    setCommentLoading(true);
    try {
      await postComment(text, mentionIds);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setCommentLoading(false);
    }
  }, [postComment]);

  const handlePostReply = useCallback(async (text: string, mentionIds: string[]) => {
    if (!replyTarget) return;
    setReplyLoading(true);
    try {
      await postComment(text, mentionIds, replyTarget.parentType, replyTarget.parentId);
      setReplyTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post reply');
    } finally {
      setReplyLoading(false);
    }
  }, [replyTarget, postComment]);

  // Separate standalone vs threaded comments
  const standaloneComments = useMemo(() => comments.filter((c) => !c.parentType), [comments]);
  const threadedComments = useMemo(() => {
    const map = new Map<string, DeliverableComment[]>();
    for (const c of comments) {
      if (c.parentType && c.parentId != null) {
        const key = `${c.parentType}-${c.parentId}`;
        const existing = map.get(key);
        if (existing) existing.push(c);
        else map.set(key, [c]);
      }
    }
    return map;
  }, [comments]);

  // Group versions by version number
  const versionGroups = useMemo(() => {
    const map = new Map<number, DeliverableFileVersion[]>();
    for (const v of versions) {
      const existing = map.get(v.version);
      if (existing) existing.push(v);
      else map.set(v.version, [v]);
    }
    const groups: VersionGroup[] = [];
    for (const [version, files] of map) {
      const first = files[0];
      groups.push({
        version,
        files,
        uploadedBy: first.uploadedBy,
        action: first.action,
        createdAt: first.createdAt,
      });
    }
    // Sort ascending by createdAt for timestamp-based association
    groups.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return groups;
  }, [versions]);

  // Build version-centric sections
  const { versionSections, orphanActions, orphanComments } = useMemo(() => {
    // Map version number → section
    const sectionMap = new Map<number, VersionSection>();
    // descending for display
    const sortedGroups = [...versionGroups].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    for (const g of sortedGroups) {
      sectionMap.set(g.version, { version: g, actions: [], standaloneComments: [], carriedOverFiles: [] });
    }

    const orphanActs: DeliverableActionLog[] = [];
    const orphanComs: DeliverableComment[] = [];

    // Associate actions with versions
    for (const action of actions) {
      // 1. Try parsing version from action string
      const parsedVersion = parseVersionFromAction(action.action);
      if (parsedVersion !== null && sectionMap.has(parsedVersion)) {
        sectionMap.get(parsedVersion)!.actions.push(action);
        continue;
      }
      // 2. Fall back to timestamp proximity
      const nearestVersion = findVersionByTimestamp(action.createdAt, versionGroups);
      if (nearestVersion !== null && sectionMap.has(nearestVersion)) {
        sectionMap.get(nearestVersion)!.actions.push(action);
      } else {
        orphanActs.push(action);
      }
    }

    // Associate standalone comments with versions by timestamp
    for (const comment of standaloneComments) {
      const nearestVersion = findVersionByTimestamp(comment.createdAt, versionGroups);
      if (nearestVersion !== null && sectionMap.has(nearestVersion)) {
        sectionMap.get(nearestVersion)!.standaloneComments.push(comment);
      } else {
        orphanComs.push(comment);
      }
    }

    // Sort actions within each section by date descending
    for (const section of sectionMap.values()) {
      section.actions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      section.standaloneComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    // Compute carried-over files: for each current file, find its best fuzzy
    // filename match (same extension, Jaccard ≥ threshold) in the previous
    // version's complete file set. Matched prev files are treated as
    // "replaced" by this version; everything unmatched carries forward.
    // Only looks at the immediate predecessor — no deep cascading.
    const ascendingGroups = [...versionGroups]; // already sorted ascending
    for (let i = 1; i < ascendingGroups.length; i++) {
      const curr = sectionMap.get(ascendingGroups[i].version)!;
      const prev = sectionMap.get(ascendingGroups[i - 1].version)!;
      const prevCompleteFiles = [...prev.version.files, ...prev.carriedOverFiles];
      const prevNormalized = prevCompleteFiles.map((f) => ({ file: f, ...normalizeFilename(f.fileName) }));
      const replacedIds = new Set<number>();
      for (const c of curr.version.files) {
        const cNorm = normalizeFilename(c.fileName);
        let bestId: number | null = null;
        let bestScore = 0;
        for (const p of prevNormalized) {
          if (replacedIds.has(p.file.id)) continue;
          if (p.ext !== cNorm.ext) continue;
          const score = jaccard(cNorm.tokens, p.tokens);
          if (score > bestScore) {
            bestScore = score;
            bestId = p.file.id;
          }
        }
        if (bestId !== null && bestScore >= FILENAME_MATCH_THRESHOLD) {
          replacedIds.add(bestId);
        }
      }
      curr.carriedOverFiles = prevCompleteFiles.filter((f) => !replacedIds.has(f.id));
    }

    // Return sections in descending version order
    const sections = sortedGroups.map((g) => sectionMap.get(g.version)!);
    return { versionSections: sections, orphanActions: orphanActs, orphanComments: orphanComs };
  }, [versionGroups, actions, standaloneComments]);

  const totalCount = versionSections.length;
  const displayedSections = showAll ? versionSections : versionSections.slice(0, 5);
  const hasMore = versionSections.length > 5;

  const mentionMembers = useMemo(() =>
    teamMembers.map((m) => ({ personId: m.personId, name: m.name, initials: m.initials })),
    [teamMembers],
  );

  // Group version sections by date
  const groupedSections = useMemo(() => {
    const groups: { label: string; sections: VersionSection[] }[] = [];
    let currentLabel = '';

    for (const section of displayedSections) {
      const date = new Date(section.version.createdAt);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let label: string;
      if (date.toDateString() === today.toDateString()) label = 'Today';
      else if (date.toDateString() === yesterday.toDateString()) label = 'Yesterday';
      else label = date.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });

      if (label !== currentLabel) {
        groups.push({ label, sections: [section] });
        currentLabel = label;
      } else {
        groups[groups.length - 1].sections.push(section);
      }
    }
    return groups;
  }, [displayedSections]);

  if (versionSections.length === 0 && orphanActions.length === 0 && orphanComments.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card overflow-hidden animate-fade-up">
        <div className="px-5 pt-4 pb-3 border-b border-stone-100 dark:border-white/[0.06]">
          <h2 className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">Version History</h2>
        </div>
        <div className="px-6 py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-[var(--subtle-bg)] border border-[var(--border-color)] flex items-center justify-center mx-auto mb-3">
            <Clock className="w-6 h-6 text-[var(--text-muted)]" />
          </div>
          <p className="text-sm text-[var(--text-secondary)]">No submissions yet</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Document versions and workflow actions will appear here</p>
        </div>
        {teamMembers.length > 0 && deliverableId && (
          <div className="px-6 py-4 border-t border-[var(--border-color)]">
            <MentionEditor
              teamMembers={mentionMembers}
              placeholder="Add a comment... Use @ to mention"
              onSubmit={handlePostStandaloneComment}
              loading={commentLoading}
            />
          </div>
        )}
      </div>
    );
  }

  // Reused for both version-anchored standalone comments and orphan
  // comments rendered under "Earlier Activity".
  const renderStandaloneComment = (c: DeliverableComment) => {
    const commentPerson = people[c.personId];
    const isOwnStandalone = currentUserId === c.personId;
    const isEditingStandalone = editingCommentId === c.id;
    return (
      <div key={`sc-${c.id}`} className="flex items-start gap-2.5 group/comment">
        <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-gray-400 dark:bg-gray-500" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
            {commentPerson && (
              <span className="inline-flex items-center gap-1">
                <Avatar
                  avatarUrl={commentPerson.avatarUrl}
                  initials={commentPerson.initials.charAt(0)}
                  size={14}
                  fallbackClassName="bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300 text-[7px] font-bold"
                />
                {commentPerson.initials}
              </span>
            )}
            <span>&middot;</span>
            <span title={formatFullDate(c.createdAt)}>{formatRelativeDate(c.createdAt)}</span>
            {isOwnStandalone && !isEditingStandalone && (
              <span className="opacity-0 group-hover/comment:opacity-100 transition-opacity flex items-center gap-0.5 ml-1">
                <button
                  onClick={() => startEditingComment(c)}
                  className="text-[var(--text-muted)] hover:text-blue-600 cursor-pointer"
                  title="Edit"
                >
                  <Pencil className="w-2.5 h-2.5" />
                </button>
                <button
                  onClick={() => setDeleteCommentTarget({ id: c.id, label: c.comment.slice(0, 40) })}
                  className="text-[var(--text-muted)] hover:text-red-600 cursor-pointer"
                  title="Delete"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </span>
            )}
          </div>
          {isEditingStandalone ? (
            <div className="mt-1 space-y-1.5">
              <textarea
                value={editCommentText}
                onChange={(e) => setEditCommentText(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 resize-none"
                rows={2}
                autoFocus
              />
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleSaveCommentEdit}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer disabled:opacity-50"
                >
                  <Check className="w-2.5 h-2.5" />
                  Save
                </button>
                <button
                  onClick={cancelEditingComment}
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-1 text-[12.5px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                {renderCommentText(c.comment, c.mentions, people)}
              </p>
              {currentUserId && (
                <CommentReactions
                  commentId={c.id}
                  reactions={c.reactions}
                  currentUserId={currentUserId}
                  people={people}
                  onReactionToggled={() => { /* optimistic — no server refetch */ }}
                />
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // Render threaded replies for a version. Non-initial workflow actions that
  // carry a comment (e.g. "For Finalization" with a reviewer note, submitted
  // without a new file) are rendered here too, interleaved chronologically —
  // otherwise the comment would be hidden inside the compact chip above.
  const renderVersionReplies = (versionNum: number, actionReplies: DeliverableActionLog[] = []) => {
    const key = `version-${versionNum}`;
    const threaded = threadedComments.get(key) || [];
    const isReplyOpen = replyTarget?.parentType === 'version' && replyTarget?.parentId === versionNum;

    type ReplyItem =
      | { kind: 'comment'; createdAt: string; data: DeliverableComment }
      | { kind: 'action'; createdAt: string; data: DeliverableActionLog };
    const items: ReplyItem[] = [
      ...threaded.map((c) => ({ kind: 'comment' as const, createdAt: c.createdAt, data: c })),
      ...actionReplies.map((a) => ({ kind: 'action' as const, createdAt: a.createdAt, data: a })),
    ].sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());

    return (
      <>
        {items.length > 0 && (
          <div className="space-y-2">
            {items.map((item) => {
              if (item.kind === 'action') {
                const a = item.data;
                const ap = people[a.performedBy];
                return (
                  <div key={`ar-${a.id}`} className="group/comment">
                    <p className="text-[12.5px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                      {renderCommentText(a.comment ?? '', a.mentions || [], people)}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--text-muted)] flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Avatar
                          avatarUrl={ap?.avatarUrl ?? null}
                          initials={ap?.initials?.charAt(0) ?? '?'}
                          size={14}
                          fallbackClassName="bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300 text-[7px] font-bold"
                        />
                        <span className="font-medium text-[var(--text-secondary)]">{ap?.initials ?? 'Unknown'}</span>
                      </span>
                      <span>&middot;</span>
                      <span className="inline-flex items-center gap-1">
                        <span className={`w-1 h-1 rounded-full ${getActionColor(a.action)}`} />
                        <span className="font-medium text-[var(--text-secondary)]">{a.action}</span>
                        {a.oldStatus !== a.newStatus && (
                          <>
                            <span className="line-through opacity-60">{a.oldStatus}</span>
                            <ArrowUpRight className="w-2 h-2" />
                            <span>{a.newStatus}</span>
                          </>
                        )}
                      </span>
                      <span>&middot;</span>
                      <span title={formatFullDate(a.createdAt)}>{formatRelativeDate(a.createdAt)}</span>
                    </div>
                  </div>
                );
              }
              const reply = item.data;
              const person = people[reply.personId];
              const isOwnComment = currentUserId === reply.personId;
              const isEditingThis = editingCommentId === reply.id;
              return (
                <div key={reply.id} className="group/comment">
                  {isEditingThis ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={editCommentText}
                        onChange={(e) => setEditCommentText(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 resize-none"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={handleSaveCommentEdit}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-2.5 h-2.5" />
                          Save
                        </button>
                        <button
                          onClick={cancelEditingComment}
                          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-[12.5px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                        {renderCommentText(reply.comment, reply.mentions, people)}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <Avatar
                            avatarUrl={person?.avatarUrl ?? null}
                            initials={person?.initials?.charAt(0) ?? '?'}
                            size={14}
                            fallbackClassName="bg-gray-100 dark:bg-gray-500/15 text-gray-700 dark:text-gray-300 text-[7px] font-bold"
                          />
                          <span className="font-medium text-[var(--text-secondary)]">{person?.initials ?? 'Unknown'}</span>
                        </span>
                        <span>&middot;</span>
                        <span title={formatFullDate(reply.createdAt)}>{formatRelativeDate(reply.createdAt)}</span>
                        {isOwnComment && (
                          <span className="opacity-0 group-hover/comment:opacity-100 transition-opacity flex items-center gap-0.5 ml-1">
                            <button
                              onClick={() => startEditingComment(reply)}
                              className="text-[var(--text-muted)] hover:text-blue-600 cursor-pointer"
                              title="Edit"
                            >
                              <Pencil className="w-2.5 h-2.5" />
                            </button>
                            <button
                              onClick={() => setDeleteCommentTarget({ id: reply.id, label: reply.comment.slice(0, 40) })}
                              className="text-[var(--text-muted)] hover:text-red-600 cursor-pointer"
                              title="Delete"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        )}
                      </div>
                      {currentUserId && (
                        <CommentReactions
                          commentId={reply.id}
                          reactions={reply.reactions}
                          currentUserId={currentUserId}
                          people={people}
                          onReactionToggled={() => { /* optimistic — no server refetch */ }}
                        />
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {isReplyOpen ? (
          <div className="mt-1">
            <MentionEditor
              teamMembers={mentionMembers}
              placeholder="Reply..."
              onSubmit={handlePostReply}
              loading={replyLoading}
              compact
              autoFocus
            />
            <button
              type="button"
              onClick={() => setReplyTarget(null)}
              className="mt-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {teamMembers.length > 0 && (
              <button
                type="button"
                onClick={() => setReplyTarget({ parentType: 'version', parentId: versionNum })}
                className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
              >
                <Reply className="w-3 h-3" />
                Reply
              </button>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <>
      <div className="rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card overflow-hidden animate-fade-up">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-stone-100 dark:border-white/[0.06]">
          <h2 className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">
            Version History
            <span className="ml-2 text-[var(--text-muted)] font-normal">({totalCount})</span>
          </h2>
        </div>

        {/* Version sections */}
        <div className="relative">
          {groupedSections.map((group) => (
            <div key={group.label}>
              {/* Date separator */}
              <div className="sticky top-0 z-10 px-6 py-2 bg-[var(--subtle-bg)] border-b border-[var(--border-color)]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{group.label}</p>
              </div>

              <div className="px-4 py-3 space-y-3">
                {group.sections.map((section, sectionIdx) => {
                  const g = section.version;
                  const person = people[g.uploadedBy];
                  const isMultiFile = g.files.length > 1;
                  const totalSize = g.files.reduce((sum, f) => sum + (f.fileSize ?? 0), 0);
                  const isOwn = currentUserId === g.uploadedBy;
                  const isEditingThis = editingVersionNum === g.version;
                  const isLatest = sectionIdx === 0 && group === groupedSections[0];
                  const nestedItemCount = section.actions.length + section.standaloneComments.length;
                  const isExpanded = isLatest || expandedVersions.has(g.version) || nestedItemCount <= 2;

                  return (
                    <div
                      key={`v-${g.version}`}
                      className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-sm"
                    >
                      {/* Version header */}
                      <div className="border-l-4 border-l-gold-400 dark:border-l-gold-500">
                        <div className="px-4 py-3.5 hover:bg-[var(--card-bg-hover)] transition-colors group">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-gold-100 text-gold-800 dark:bg-gold-500/15 dark:text-gold-300 rounded-md">
                                  v{g.version}
                                </span>
                                {isLatest && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 rounded-md">
                                    Latest
                                  </span>
                                )}
                                <span className="text-sm font-medium text-[var(--text-primary)]">
                                  {g.files.length + section.carriedOverFiles.length} file{g.files.length + section.carriedOverFiles.length !== 1 ? 's' : ''}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-1.5 text-xs text-[var(--text-secondary)] flex-wrap">
                                {person && (
                                  <span className="inline-flex items-center gap-1">
                                    <Avatar
                                      avatarUrl={person.avatarUrl}
                                      initials={person.initials.charAt(0)}
                                      size={16}
                                      fallbackClassName="bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[8px] font-bold"
                                    />
                                    {person.initials}
                                  </span>
                                )}
                                <span className="text-[var(--text-muted)]">&middot;</span>
                                <span className="text-[var(--text-muted)]" title={formatFullDate(g.createdAt)}>{formatRelativeDate(g.createdAt)}</span>
                                {(() => {
                                  const workflow = section.actions.filter((x) => !isEditAction(x.action));
                                  const initialId = workflow.length > 0 ? workflow[workflow.length - 1].id : null;
                                  // Actions with comments now render as replies — only count action-only chips here.
                                  const otherCount = workflow.filter((x) => x.id !== initialId && !x.comment).length;
                                  if (otherCount === 0) return null;
                                  const isOpen = expandedActions.has(g.version);
                                  return (
                                    <>
                                      <span className="text-[var(--text-muted)]">&middot;</span>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); toggleExpandedActions(g.version); }}
                                        className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--text-muted)] hover:text-blue-600 dark:hover:text-blue-400 hover:underline underline-offset-2 cursor-pointer"
                                        title={isOpen ? 'Hide actions' : 'Show actions'}
                                      >
                                        {isOpen ? <ChevronDown className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
                                        {otherCount} action{otherCount !== 1 ? 's' : ''}
                                      </button>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>

                            {/* Version-level edit/delete */}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              {isOwn && !isEditingThis && (
                                <>
                                  <button
                                    onClick={() => startEditing(g)}
                                    className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-blue-600 bg-[var(--subtle-bg)] hover:bg-blue-50 dark:hover:bg-blue-500/10 border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                                    title="Edit submission"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteTarget({
                                      version: g.version,
                                      deliverableId,
                                      label: `v${g.version} (${g.files.length} file${g.files.length > 1 ? 's' : ''})`,
                                    })}
                                    className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-red-600 bg-[var(--subtle-bg)] hover:bg-red-50 dark:hover:bg-red-500/10 border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                                    title="Delete submission"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Inline edit form */}
                          {isEditingThis && (
                            <div className="mt-3 p-3 bg-blue-50/50 dark:bg-blue-500/5 rounded-lg border border-blue-200/60 dark:border-blue-500/20 space-y-3">
                              <div>
                                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">Action Label</label>
                                <input
                                  type="text"
                                  value={editAction}
                                  onChange={(e) => setEditAction(e.target.value)}
                                  placeholder="e.g. Initial draft, Revised version..."
                                  className="w-full px-3 py-1.5 text-xs bg-white dark:bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
                                />
                              </div>

                              {/* All files — each replaceable */}
                              <div>
                                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 block">Current Files</label>
                                <div className="space-y-1.5">
                                  {g.files.map((f) => (
                                    <label key={f.id} className="relative flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] bg-white dark:bg-[var(--card-bg)] border border-dashed border-[var(--border-color)] rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
                                      <RefreshCw className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                                      <span className="truncate flex-1">
                                        {editReplacements[f.id] ? editReplacements[f.id].name : f.fileName}
                                      </span>
                                      {editReplacements[f.id] && <span className="text-[10px] text-blue-500 shrink-0">replacing</span>}
                                      <input
                                        type="file"
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        onChange={(e) => {
                                          const picked = e.target.files?.[0];
                                          if (picked) {
                                            setEditReplacements((prev) => ({ ...prev, [f.id]: picked }));
                                          }
                                        }}
                                      />
                                    </label>
                                  ))}
                                </div>
                              </div>

                              {/* Add more files */}
                              <div>
                                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">Add Files (optional)</label>
                                <label className="relative flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] bg-white dark:bg-[var(--card-bg)] border border-dashed border-[var(--border-color)] rounded-lg cursor-pointer hover:border-blue-400 transition-colors">
                                  <Plus className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                                  {editAddFiles.length > 0
                                    ? `${editAddFiles.length} file${editAddFiles.length > 1 ? 's' : ''} to add`
                                    : 'Add more files to this version...'}
                                  <input
                                    type="file"
                                    multiple
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    onChange={(e) => {
                                      if (e.target.files) setEditAddFiles(Array.from(e.target.files));
                                    }}
                                  />
                                </label>
                                {editAddFiles.length > 0 && (
                                  <div className="mt-1.5 space-y-1">
                                    {editAddFiles.map((f, i) => (
                                      <p key={i} className="text-[10px] text-[var(--text-muted)] truncate">
                                        {f.name}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2 justify-end">
                                <button
                                  onClick={cancelEditing}
                                  disabled={editLoading}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-white dark:bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                                >
                                  <X className="w-3 h-3" />
                                  Cancel
                                </button>
                                <button
                                  onClick={handleSaveEdit}
                                  disabled={editLoading}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                                >
                                  {editLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                  Save
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Compact action chips — shown only when the user toggles the
                              "N actions" link in the version meta line above. Single wrapping
                              row of small chips: each chip is "INI Action · status arrow · date". */}
                          {!isEditingThis && expandedActions.has(g.version) && (() => {
                            const workflow = section.actions.filter((x) => !isEditAction(x.action));
                            const initialId = workflow.length > 0 ? workflow[workflow.length - 1].id : null;
                            // Actions carrying a comment render as replies below; chips only cover bare status transitions.
                            const others = workflow.filter((x) => x.id !== initialId && !x.comment);
                            if (others.length === 0) return null;
                            return (
                              <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px] text-[var(--text-muted)]">
                                {others.map((a, idx) => {
                                  const ap = people[a.performedBy];
                                  return (
                                    <span
                                      key={`chip-${a.id}`}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--subtle-bg)] border border-[var(--border-color)]"
                                    >
                                      <span className={`w-1 h-1 rounded-full ${getActionColor(a.action)}`} />
                                      {ap && <span className="font-medium text-[var(--text-secondary)]">{ap.initials}</span>}
                                      <span className="font-medium text-[var(--text-secondary)]">{a.action}</span>
                                      {a.oldStatus !== a.newStatus && (
                                        <>
                                          <span className="line-through opacity-60">{a.oldStatus}</span>
                                          <ArrowUpRight className="w-2 h-2" />
                                          <span>{a.newStatus}</span>
                                        </>
                                      )}
                                      <span>&middot;</span>
                                      <span title={formatFullDate(a.createdAt)}>{formatRelativeDate(a.createdAt)}</span>
                                      {idx === others.length - 1 ? null : null}
                                    </span>
                                  );
                                })}
                              </div>
                            );
                          })()}

                          {/* Initial submission comment — flush, no box, primary text.
                              Rendered ABOVE the file list so the comment + files read as
                              a single submission (matching the Latest Submission card). */}
                          {!isEditingThis && (() => {
                            const workflowActions = section.actions.filter((x) => !isEditAction(x.action));
                            const editTrail = section.actions.filter((x) => isEditAction(x.action));
                            const initialAction = workflowActions.length > 0
                              ? workflowActions[workflowActions.length - 1]
                              : null;
                            if (!initialAction || !initialAction.comment) return null;
                            const ip = people[initialAction.performedBy];
                            const editsOpen = expandedEditHistory.has(g.version);
                            return (
                              <div className="mt-3">
                                <p className="text-[13px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                                  {renderCommentText(initialAction.comment, initialAction.mentions || [], people)}
                                </p>
                                {(initialAction.action || editTrail.length > 0) && (
                                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--text-muted)] flex-wrap">
                                    {initialAction.action && (
                                      <span className="italic">{initialAction.action}</span>
                                    )}
                                    {editTrail.length > 0 && (
                                      <>
                                        {initialAction.action && <span>&middot;</span>}
                                        <button
                                          type="button"
                                          onClick={() => toggleEditHistory(g.version)}
                                          className="italic text-[var(--text-muted)] hover:text-blue-600 dark:hover:text-blue-400 underline-offset-2 hover:underline cursor-pointer"
                                          title="Show edit history"
                                        >
                                          edited{editTrail.length > 1 ? ` ${editTrail.length} times` : ''}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                                {editsOpen && editTrail.length > 0 && (
                                  <div className="mt-2 ml-1 border-l border-dashed border-[var(--border-color)] pl-3 space-y-1.5">
                                    {editTrail.map((e) => {
                                      const ep = people[e.performedBy];
                                      return (
                                        <div key={`edit-${e.id}`} className="text-[10px] text-[var(--text-muted)]">
                                          <div className="flex items-center gap-1.5">
                                            <span className="font-medium text-[var(--text-secondary)]">{ep?.initials ?? 'Unknown'}</span>
                                            <span>{e.action}</span>
                                            <span>&middot;</span>
                                            <span title={formatFullDate(e.createdAt)}>{formatRelativeDate(e.createdAt)}</span>
                                          </div>
                                          {e.comment && (
                                            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] whitespace-pre-wrap">
                                              {renderCommentText(e.comment, e.mentions || [], people)}
                                            </p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* Unified file list: own files + carried-over files */}
                          {!isEditingThis && (
                            <div className="mt-3 space-y-1.5">
                              {g.files.map((f) => (
                                <div
                                  key={f.id}
                                  className="flex items-center gap-2.5 px-3 py-2 bg-gradient-to-r from-gold-50/80 to-white dark:from-gold-500/10 dark:to-[var(--card-bg-hover)] rounded-lg border border-gold-200/70 dark:border-gold-500/25 shadow-sm hover:shadow-md hover:border-gold-400 dark:hover:border-gold-500/50 transition-all"
                                >
                                  <FileText className="w-4 h-4 text-gold-600 dark:text-gold-400 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">{f.fileName}</p>
                                    {f.fileSize && (
                                      <p className="text-[10px] text-[var(--text-muted)]">{formatFileSize(f.fileSize)}</p>
                                    )}
                                  </div>
                                  {f.needsReupload ? (
                                    <NeedsReuploadBadge />
                                  ) : (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      onClick={() => setPreviewFile({ name: f.fileName, url: f.fileUrl })}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                                      title="Preview"
                                    >
                                      <Eye className="w-3 h-3" />
                                      Preview
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void downloadFile({ name: f.fileName, url: f.fileUrl });
                                      }}
                                      className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                                      title="Download"
                                    >
                                      <Download className="w-3 h-3" />
                                    </button>
                                  </div>
                                  )}
                                </div>
                              ))}
                              {section.carriedOverFiles.map((f) => (
                                <div
                                  key={`co-${f.id}`}
                                  className="flex items-center gap-2.5 px-3 py-2 bg-gradient-to-r from-gold-50/80 to-white dark:from-gold-500/10 dark:to-[var(--card-bg-hover)] rounded-lg border border-gold-200/70 dark:border-gold-500/25 shadow-sm hover:shadow-md hover:border-gold-400 dark:hover:border-gold-500/50 transition-all"
                                >
                                  <FileText className="w-4 h-4 text-gold-600 dark:text-gold-400 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">{f.fileName}</p>
                                    <p className="text-[10px] text-[var(--text-muted)]">
                                      {f.fileSize ? formatFileSize(f.fileSize) : ''}
                                      {f.fileSize ? ' · ' : ''}from v{f.version}
                                    </p>
                                  </div>
                                  {f.needsReupload ? (
                                    <NeedsReuploadBadge />
                                  ) : (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      onClick={() => setPreviewFile({ name: f.fileName, url: f.fileUrl })}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                                      title="Preview"
                                    >
                                      <Eye className="w-3 h-3" />
                                      Preview
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void downloadFile({ name: f.fileName, url: f.fileUrl });
                                      }}
                                      className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                                      title="Download"
                                    >
                                      <Download className="w-3 h-3" />
                                    </button>
                                  </div>
                                  )}
                                </div>
                              ))}

                              {/* Reactions for the version (attached to the initial comment). */}
                              {currentUserId && deliverableId && (
                                <div className="mt-2">
                                  <VersionReactions
                                    deliverableId={deliverableId}
                                    version={g.version}
                                    reactions={versionReactions[g.version] ?? []}
                                    currentUserId={currentUserId}
                                    people={people}
                                    onReactionToggled={() => { /* optimistic — no server refetch */ }}
                                  />
                                </div>
                              )}

                              {/* Threaded replies + Reply button — indented to show
                                  the thread under the submission. Non-initial workflow
                                  actions carrying a comment (no file) also surface here
                                  so the comment stays visible. */}
                              {(() => {
                                const workflow = section.actions.filter((x) => !isEditAction(x.action));
                                const initialId = workflow.length > 0 ? workflow[workflow.length - 1].id : null;
                                const actionReplies = workflow.filter((x) => x.id !== initialId && !!x.comment);
                                return (
                                  <div className="mt-2 pl-3 ml-3 border-l-2 border-[var(--border-color)] space-y-2">
                                    {renderVersionReplies(g.version, actionReplies)}
                                  </div>
                                );
                              })()}
                            </div>
                          )}

                        </div>

                        {/* Nested content: standalone comments only. Workflow actions
                            now render as compact chips above the file list (toggled via
                            the "N actions" link in the version meta), and edit-trail entries
                            collapse into the "edited" indicator on the initial comment. */}
                        {section.standaloneComments.length > 0 && (
                          <>
                            <div className="border-t border-dashed border-[var(--border-color)]" />
                            <div className="px-4 py-3 space-y-3">
                              {section.standaloneComments.map((c) => renderStandaloneComment(c))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Orphan actions and standalone comments (before any version, or
              when no version files exist at all). Both are merged and sorted
              chronologically so the timeline reads naturally. */}
          {(orphanActions.length > 0 || orphanComments.length > 0) && (() => {
            type OrphanItem =
              | { kind: 'action'; createdAt: string; data: DeliverableActionLog }
              | { kind: 'comment'; createdAt: string; data: DeliverableComment };
            const items: OrphanItem[] = [
              ...orphanActions.map((a) => ({ kind: 'action' as const, createdAt: a.createdAt, data: a })),
              ...orphanComments.map((c) => ({ kind: 'comment' as const, createdAt: c.createdAt, data: c })),
            ].sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());

            return (
              <div>
                <div className="sticky top-0 z-10 px-6 py-2 bg-[var(--subtle-bg)] border-b border-[var(--border-color)]">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Earlier Activity</p>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {items.map((item) => {
                    if (item.kind === 'comment') {
                      return (
                        <div key={`oc-${item.data.id}`} className="px-4 py-1.5">
                          {renderStandaloneComment(item.data)}
                        </div>
                      );
                    }
                    const a = item.data;
                    const actionPerson = people[a.performedBy];
                    return (
                      <div key={`oa-${a.id}`} className="flex items-start gap-2.5 px-4 py-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${getActionColor(a.action)}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] flex-wrap">
                            {actionPerson && <span className="font-medium text-[var(--text-secondary)]">{actionPerson.initials}</span>}
                            <span className="font-medium text-[var(--text-secondary)]">{a.action}</span>
                            {a.oldStatus !== a.newStatus && (
                              <span className="inline-flex items-center gap-1">
                                <span className="line-through">{a.oldStatus}</span>
                                <ArrowUpRight className="w-2.5 h-2.5" />
                                <span>{a.newStatus}</span>
                              </span>
                            )}
                            <span>&middot;</span>
                            <span title={formatFullDate(a.createdAt)}>{formatRelativeDate(a.createdAt)}</span>
                          </div>
                          {a.comment && (
                            <p className="mt-0.5 text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                              {renderCommentText(a.comment, a.mentions || [], people)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Show more */}
          {hasMore && !showAll && (
            <div className="px-6 py-4 border-t border-[var(--border-color)]">
              <button
                onClick={() => setShowAll(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--subtle-bg)] hover:bg-[var(--card-bg-hover)] rounded-lg border border-[var(--border-color)] transition-all cursor-pointer"
              >
                <ChevronDown className="w-4 h-4" />
                Show all {versionSections.length} versions
              </button>
            </div>
          )}
        </div>

        {/* Standalone comment input */}
        {teamMembers.length > 0 && deliverableId && (
          <div className="px-6 py-4 border-t border-[var(--border-color)]">
            <MentionEditor
              teamMembers={mentionMembers}
              placeholder="Add a comment... Use @ to mention"
              onSubmit={handlePostStandaloneComment}
              loading={commentLoading}
            />
          </div>
        )}
      </div>

      <FilePreviewModal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        file={previewFile}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
        title="Delete Submission"
        message={`Are you sure you want to delete ${deleteTarget?.label ?? 'this submission'}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteLoading}
      />

      <ConfirmDialog
        open={!!deleteCommentTarget}
        onConfirm={handleDeleteComment}
        onCancel={() => setDeleteCommentTarget(null)}
        title="Delete Comment"
        message={`Are you sure you want to delete this comment? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </>
  );
}
