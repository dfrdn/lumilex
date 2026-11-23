'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, FileText, Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import type { Trademark } from '@/types/notion';
import { manilaToday } from '@/lib/dates';
import { isDesignation } from '@/lib/trademark-deadlines';
import {
  EXTENSION_PURPOSES, EXTENSION_PURPOSE_KEYS, EXTENSION_REASONS, EXTENSION_REASON_KEYS, extensionProblems, suggestedExtension,
  type ExtensionPurpose, type ExtensionReason,
} from '@/lib/trademarks/extension-request';

const LABEL = 'block text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5';
const INPUT = 'w-full px-3 py-2 text-sm text-stone-800 dark:text-stone-100 bg-stone-50/80 dark:bg-white/5 border border-stone-200 dark:border-white/10 rounded-lg placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400';

function Tick({ on }: { on: boolean }) {
  return (
    <span className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-stone-300 dark:border-white/20'}`}>
      {on && <Check className="w-3 h-3" />}
    </span>
  );
}

/**
 * The request for extension of time to IPOPHL, laid out as the firm's
 * responses are: pick what it is for and why (the items and reasons of
 * IPOPHL's optional form), and download it on the letterhead to sign and file. Recording the extension stays the mark's own action, once filed.
 */
export default function ExtensionRequestModal({ trademark, onClose }: { trademark: Trademark; onClose: () => void }) {
  const suggested = suggestedExtension(trademark);
  const [purpose, setPurpose] = useState<ExtensionPurpose>(suggested?.purpose ?? 'oa_response');
  const [reasons, setReasons] = useState<ExtensionReason[]>(suggested?.reasons ?? ['complexity']);
  const [otherReason, setOtherReason] = useState('');
  const [documentNo, setDocumentNo] = useState('');
  const [examiner, setExaminer] = useState('');
  const [division, setDivision] = useState('');
  const [busy, setBusy] = useState(false);

  const input = { purpose, reasons, otherReason, documentNo, examiner, division };
  // A DAU or a fee answers no examiner's action, so there is no notice to place the request by.
  const fromNotice = purpose === 'oa_response' || purpose === 'appeal';
  const problems = extensionProblems(trademark, input, manilaToday());
  const noReason = !reasons.length && !otherReason.trim();

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/trademark/${trademark.id}/extension-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose,
          reasons,
          otherReason: otherReason.trim() || undefined,
          ...(fromNotice ? { documentNo: documentNo.trim() || undefined, examiner: examiner.trim() || undefined, division: division.trim() || undefined } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Could not draft the request');
      }
      const name = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name ? decodeURIComponent(name) : 'Request for Extension.docx';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Request drafted — check it, sign it, and file it via eDocfile');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not draft the request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      title="Request for extension of time"
      description="To the Director of Trademarks, laid out as the firm’s responses are, on the letterhead"
      icon={<FileText className="w-4 h-4" />}
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void download()} disabled={busy || noReason}>
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Download Word file
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <div>
          <p className={LABEL}>This is to request for extension of time to</p>
          <div className="space-y-1">
            {EXTENSION_PURPOSE_KEYS.filter((k) => !(isDesignation(trademark) && k === 'fees')).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPurpose(k)}
                className={`w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-sm cursor-pointer ${purpose === k ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-800 dark:text-blue-200' : 'text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5'}`}
              >
                <span className={`mt-1 w-3 h-3 shrink-0 rounded-full border ${purpose === k ? 'border-4 border-blue-600' : 'border-stone-300 dark:border-white/20'}`} />
                <span><span className="font-medium">{EXTENSION_PURPOSES[k].letter}.</span> {EXTENSION_PURPOSES[k].text}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className={LABEL}>The reasons</p>
          <div className="space-y-1">
            {EXTENSION_REASON_KEYS.map((r) => {
              const on = reasons.includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReasons((prev) => (on ? prev.filter((x) => x !== r) : [...prev, r]))}
                  className="w-full flex items-start gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5 cursor-pointer"
                >
                  <Tick on={on} />
                  <span>{EXTENSION_REASONS[r]}{r === 'regulations' && <span className="text-stone-400 dark:text-stone-500"> (for B, D and E)</span>}</span>
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={otherReason}
            onChange={(e) => setOtherReason(e.target.value)}
            placeholder="Others, please state"
            className={`${INPUT} mt-2`}
          />
        </div>

        {fromNotice && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={LABEL} htmlFor="extension-document">Document No.</label>
              <input id="extension-document" type="text" value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} placeholder="2026/77206" className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor="extension-examiner">Examiner</label>
              <input id="extension-examiner" type="text" value={examiner} onChange={(e) => setExaminer(e.target.value)} placeholder="As on the notice" className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor="extension-division">Division</label>
              <input id="extension-division" type="text" value={division} onChange={(e) => setDivision(e.target.value)} placeholder="TMED I" className={INPUT} />
            </div>
          </div>
        )}

        {problems.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-amber-50 dark:bg-amber-500/10 ring-1 ring-inset ring-amber-200 dark:ring-amber-500/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  );
}
