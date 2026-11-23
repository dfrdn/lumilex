import type { CorporationMeeting, Resolution } from '@/types/corporations';

/**
 * Human filenames for corporate documents whose storage keys are timestamps
 * (`…/1780475524346-minutes.docx`). Used for the preview title and the name a
 * download saves under.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-05-03` → `03 May 2026`, the firm's filename date style. */
export function filenameDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return iso;
  return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function extensionOf(path: string | null | undefined, fallback: string): string {
  const last = path?.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot + 1) : fallback;
}

/** Strip characters that are illegal in a filename on Windows or macOS. */
function safe(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
}

export function generatedDocName(r: Pick<Resolution, 'title' | 'dateOfResolution' | 'generatedFilePath'>): string {
  const date = r.dateOfResolution ? `${filenameDate(r.dateOfResolution)} — ` : '';
  return safe(`${date}${r.title || 'Resolution'}.${extensionOf(r.generatedFilePath, 'docx')}`);
}

export type MeetingFileSlot = 'minutes' | 'notice' | 'waiver' | 'attendance' | 'recording';

const SLOT_LABEL: Record<MeetingFileSlot, string> = {
  minutes: 'Minutes',
  notice: 'Notice',
  waiver: 'Waiver of Notice',
  attendance: 'Attendance Sheet',
  recording: 'Recording',
};

export function meetingFilePath(m: CorporationMeeting, slot: MeetingFileSlot): string | null {
  switch (slot) {
    case 'minutes': return m.minutesFilePath;
    case 'notice': return m.noticeFilePath;
    case 'waiver': return m.waiverOfNoticeFilePath;
    case 'attendance': return m.attendanceSheetPath;
    case 'recording': return m.recordingPath;
  }
}

export function meetingFileName(
  m: Pick<CorporationMeeting, 'meetingDate' | 'meetingType'>,
  slot: MeetingFileSlot,
  path: string | null | undefined,
): string {
  return safe(`${filenameDate(m.meetingDate)} — ${m.meetingType} ${SLOT_LABEL[slot]}.${extensionOf(path, 'docx')}`);
}
