// Exclusivity helpers for incoming-file actions. We track what action has
// been taken on a file and by whom using the existing columns on the files
// table — files.action_taken (text) + files.acted_upon_by_ids (text[]) —
// rather than a separate log table. Once action_taken is non-empty, the
// file is considered acted upon and other users cannot choose a different
// action in the inbox.
//
// The three partner-level choices this layer surfaces are:
//   - Internal Discussion (Set ID)
//   - Prepare Response    (Create Deliverable)
//   - Prepare Status Report (Generate Status Report)

import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export const FILE_ACTION_INTERNAL_DISCUSSION = 'Internal Discussion';
export const FILE_ACTION_PREPARE_RESPONSE = 'Prepare Response';
export const FILE_ACTION_PREPARE_STATUS_REPORT = 'Prepare Status Report';

export type FileActionLabel =
  | typeof FILE_ACTION_INTERNAL_DISCUSSION
  | typeof FILE_ACTION_PREPARE_RESPONSE
  | typeof FILE_ACTION_PREPARE_STATUS_REPORT;

export interface FileActionState {
  actionTaken: string | null;
  actedUponByIds: string[];
}

/** Fetch the current action state for a file — used by routes to decide
 *  whether to reject a duplicate action and by the UI to render the
 *  "already acted on" badge. */
export async function fetchFileActionState(
  fileId: string,
  firmId: string,
): Promise<FileActionState | null> {
  if (!fileId) return null;
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('files')
    .select('action_taken, acted_upon_by_ids')
    .eq('notion_id', fileId)
    .maybeSingle();
  if (!data) return null;
  return {
    actionTaken: data.action_taken ?? null,
    actedUponByIds: (data.acted_upon_by_ids as string[] | null) ?? [],
  };
}

/** True when `state` reflects a file that's already been acted upon. */
export function isFileActedUpon(state: FileActionState | null | undefined): boolean {
  if (!state) return false;
  return !!(state.actionTaken && state.actionTaken.trim().length > 0);
}

/** Mark a file as acted upon. Writes action_taken + adds the actor to
 *  acted_upon_by_ids (as a single-element array — the first actor wins).
 *  Idempotent on repeat calls from the same user for the same label.
 *
 *  Returns { updated: true } on success, or { updated: false, existing } when
 *  the file was already acted upon by someone else. The caller is responsible
 *  for returning a 409-ish response in that case. */
export async function markFileActedUpon(params: {
  fileId: string;
  firmId: string;
  actorId: string;
  label: FileActionLabel;
}): Promise<{ updated: true } | { updated: false; existing: FileActionState }> {
  const supabase = getServiceDbForFirm(params.firmId);

  // Check current state first.
  const current = await fetchFileActionState(params.fileId, params.firmId);
  if (current && isFileActedUpon(current) && current.actionTaken !== params.label) {
    return { updated: false, existing: current };
  }
  // Same user re-clicking same action is fine.
  if (
    current &&
    current.actionTaken === params.label &&
    current.actedUponByIds.includes(params.actorId)
  ) {
    return { updated: true };
  }

  const { error } = await supabase
    .from('files')
    .update({
      action_taken: params.label,
      acted_upon_by_ids: [params.actorId],
    })
    .eq('notion_id', params.fileId);

  if (error) {
    console.warn('[file-action] update failed:', error.message);
    return { updated: false, existing: current ?? { actionTaken: null, actedUponByIds: [] } };
  }
  return { updated: true };
}

/** Release a file-action claim the current user holds. No-op if no claim
 *  exists, a different user holds it, or it was already promoted to a
 *  different label (e.g. the deliverable was actually created).
 *
 *  Returns { released: true } only when the claim matched the actor + label
 *  and was cleared. */
export async function releaseFileAction(params: {
  fileId: string;
  firmId: string;
  actorId: string;
  label: FileActionLabel;
}): Promise<{ released: boolean }> {
  const current = await fetchFileActionState(params.fileId, params.firmId);
  if (!current?.actionTaken) return { released: false };
  if (current.actionTaken !== params.label) return { released: false };
  if (!current.actedUponByIds.includes(params.actorId)) return { released: false };

  const supabase = getServiceDbForFirm(params.firmId);
  // action_taken is NOT NULL with default ''; use '' (not null) to avoid 23502.
  const { error } = await supabase
    .from('files')
    .update({ action_taken: '', acted_upon_by_ids: [] })
    .eq('notion_id', params.fileId);

  if (error) {
    console.warn('[file-action] release failed:', error.message);
    return { released: false };
  }
  return { released: true };
}
