'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Loader2, Pin, Save, X } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import { SOURCES, SOURCE_KEYS, TYPE_TAXONOMY, PRACTICE_AREAS, type SourceKey } from '@/lib/issuances/sources';
import type { Issuance } from '@/hooks/use-issuances';
import { SimpleDropdown, SimpleMultiDropdown } from './SimpleDropdown';

interface Props {
  issuance: Issuance | null; // null = create
  onBack: () => void;
  onSaved: () => void;
}

export default function IssuanceForm({ issuance, onBack, onSaved }: Props) {
  const isEdit = !!issuance;
  const [source, setSource] = useState<SourceKey | null>(
    (issuance?.source as SourceKey) ?? null,
  );
  const [type, setType] = useState<string | null>(issuance?.type ?? null);
  const [number, setNumber] = useState(issuance?.number ?? '');
  const [title, setTitle] = useState(issuance?.title ?? '');
  const [subject, setSubject] = useState(issuance?.subject ?? '');
  const [dateIssued, setDateIssued] = useState<string | null>(issuance?.date_issued ?? null);
  const [dateEffective, setDateEffective] = useState<string | null>(
    issuance?.date_effective ?? null,
  );
  const [summary, setSummary] = useState(issuance?.summary ?? '');
  const [sourceUrl, setSourceUrl] = useState(issuance?.source_url ?? '');
  const [practiceAreas, setPracticeAreas] = useState<string[]>(issuance?.practice_areas ?? []);
  const [tags, setTags] = useState<string[]>(issuance?.tags ?? []);
  const [pinned, setPinned] = useState(issuance?.pinned ?? false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeOptions = useMemo(() => {
    if (!source) return [];
    return TYPE_TAXONOMY[source].map((t) => ({ id: t, label: t }));
  }, [source]);

  const canSubmit =
    !!source && !!type && title.trim().length > 0 && sourceUrl.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit || !source || !type) return;
    setSaving(true);
    setError(null);

    const payload = {
      ...(isEdit ? { id: issuance!.id } : {}),
      source,
      type,
      number: number.trim() || null,
      title: title.trim(),
      subject: subject.trim() || null,
      date_issued: dateIssued || null,
      date_effective: dateEffective || null,
      summary: summary.trim() || null,
      source_url: sourceUrl.trim(),
      practice_areas: practiceAreas,
      tags,
      pinned,
    };

    try {
      const res = await fetch('/api/issuances', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          type="button"
          disabled={!canSubmit || saving}
          onClick={handleSubmit}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isEdit ? 'Save changes' : 'Create issuance'}
        </button>
      </div>

      <h1 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
        {isEdit ? 'Edit issuance' : 'New issuance'}
      </h1>

      {error && (
        <div className="px-3 py-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg dark:bg-rose-900/20 dark:border-rose-800/40 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SimpleDropdown
          label="Source"
          required
          value={source}
          placeholder="Pick the issuing body"
          options={SOURCE_KEYS.map((k) => ({
            id: k,
            label: SOURCES[k].label,
            sublabel: SOURCES[k].shortLabel,
          }))}
          onChange={(v) => {
            setSource(v as SourceKey | null);
            setType(null); // reset type when source changes
          }}
        />
        <SimpleDropdown
          label="Type"
          required
          value={type}
          placeholder={source ? 'Pick the issuance type' : 'Select source first'}
          options={typeOptions}
          onChange={setType}
          disabled={!source}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
            Citation / Number
          </label>
          <input
            type="text"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="e.g. RMC 12-2026"
            className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50/80 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-400 dark:bg-stone-800 dark:border-stone-700 dark:text-stone-100"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
            Source URL <span className="text-rose-500">*</span>
          </label>
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50/80 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-400 dark:bg-stone-800 dark:border-stone-700 dark:text-stone-100"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
          Title <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Full title or subject of the issuance"
          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50/80 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-400 dark:bg-stone-800 dark:border-stone-700 dark:text-stone-100"
        />
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
          Subject (short)
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Short topical handle, e.g. 'VAT — digital services'"
          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50/80 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-400 dark:bg-stone-800 dark:border-stone-700 dark:text-stone-100"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
            Date issued
          </label>
          <DatePickerInput
            value={dateIssued}
            onChange={setDateIssued}
            placeholder="Date issued"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
            Date effective
          </label>
          <DatePickerInput
            value={dateEffective}
            onChange={setDateEffective}
            placeholder="Date effective"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
          Summary
        </label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="2-4 sentence summary of what this issuance does and who it affects."
          rows={5}
          className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 bg-stone-50/80 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-400 resize-y dark:bg-stone-800 dark:border-stone-700 dark:text-stone-100"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SimpleMultiDropdown
          label="Practice areas"
          values={practiceAreas}
          placeholder="Tag relevant practice areas"
          options={PRACTICE_AREAS.map((a) => ({ id: a, label: a }))}
          onChange={setPracticeAreas}
        />
        <TagsInput label="Tags (free-form)" values={tags} onChange={setTags} />
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400 cursor-pointer">
        <input
          type="checkbox"
          checked={pinned}
          onChange={(e) => setPinned(e.target.checked)}
          className="rounded border-stone-300 dark:border-stone-600 text-gold-500 focus:ring-gold-500/30"
        />
        <Pin className="w-3.5 h-3.5" /> Pin to top
      </label>
    </div>
  );
}

// ── Free-form tag input ──────────────────────────────────────────────
// Type → Enter (or comma) commits a tag. Backspace on an empty input pops
// the last chip. Duplicates and empty strings are silently rejected.
function TagsInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (values.includes(t)) {
      setDraft('');
      return;
    }
    onChange([...values, t]);
    setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div>
      <label className="block text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 dark:text-stone-500">
        {label}
      </label>
      <div className="min-h-[40px] flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border border-stone-200 bg-stone-50/80 focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-500/30 dark:bg-stone-800 dark:border-stone-700">
        {values.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs font-medium bg-stone-100 border border-stone-200 text-stone-700 rounded-full dark:bg-stone-700 dark:border-stone-600 dark:text-stone-200"
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== t))}
              className="p-0.5 rounded-full text-stone-400 hover:text-rose-500 hover:bg-rose-50 cursor-pointer dark:text-stone-400 dark:hover:bg-rose-500/10"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => commit(draft)}
          placeholder={values.length === 0 ? 'Type and press Enter…' : ''}
          className="flex-1 min-w-[8ch] bg-transparent text-sm outline-none placeholder:text-stone-400 dark:text-stone-100 dark:placeholder:text-stone-500"
        />
      </div>
      <p className="mt-1 text-[10px] text-stone-400 dark:text-stone-500">
        Press Enter or comma to add. Backspace removes the last tag.
      </p>
    </div>
  );
}
