'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, ClipboardPaste, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { EntityFieldConfig } from '@/lib/admin/entity-config';

// ── Types ───────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  entity: string;
  entityLabel: string;
  fields: EntityFieldConfig[];
  onSuccess: () => void;
}

type Tab = 'paste' | 'csv';

interface ParsedData {
  headers: string[];
  rows: string[][];
}

interface ImportResult {
  created: number;
  errors: { row: number; message: string }[];
}

// ── Fuzzy matching helper ───────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fuzzyMatch(header: string, field: EntityFieldConfig): boolean {
  const h = normalize(header);
  const k = normalize(field.key);
  const l = normalize(field.label);
  const c = normalize(field.supabaseColumn);
  return h === k || h === l || h === c || l.includes(h) || h.includes(l);
}

function autoMapColumns(
  headers: string[],
  fields: EntityFieldConfig[],
): Record<number, string> {
  const mapping: Record<number, string> = {};
  const usedFields = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    for (const field of fields) {
      if (usedFields.has(field.key)) continue;
      if (fuzzyMatch(headers[i], field)) {
        mapping[i] = field.key;
        usedFields.add(field.key);
        break;
      }
    }
  }
  return mapping;
}

// ── CSV parser ──────────────────────────────────────────────────

function parseCSV(text: string): ParsedData {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field.trim());
        field = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        current.push(field.trim());
        if (current.some((c) => c !== '')) rows.push(current);
        current = [];
        field = '';
        if (ch === '\r') i++; // skip \n after \r
      } else {
        field += ch;
      }
    }
  }
  // Last field / row
  current.push(field.trim());
  if (current.some((c) => c !== '')) rows.push(current);

  if (rows.length === 0) return { headers: [], rows: [] };
  return { headers: rows[0], rows: rows.slice(1) };
}

// ── TSV parser ──────────────────────────────────────────────────

function parseTSV(text: string): ParsedData {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split('\t').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split('\t').map((c) => c.trim()));
  return { headers, rows };
}

// ── Component ───────────────────────────────────────────────────

export default function BatchImport({
  open,
  onClose,
  entity,
  entityLabel,
  fields,
  onSuccess,
}: Props) {
  const [tab, setTab] = useState<Tab>('paste');
  const [pasteText, setPasteText] = useState('');
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setTab('paste');
      setPasteText('');
      setParsed(null);
      setColumnMapping({});
      setImporting(false);
      setProgress({ done: 0, total: 0 });
      setResult(null);
      setError('');
      setDragOver(false);
    }
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !importing) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, importing]);

  // Parse paste text as TSV
  useEffect(() => {
    if (tab !== 'paste' || !pasteText.trim()) {
      if (tab === 'paste') setParsed(null);
      return;
    }
    const data = parseTSV(pasteText);
    setParsed(data);
    setColumnMapping(autoMapColumns(data.headers, fields));
  }, [pasteText, tab, fields]);

  const handleFileChange = useCallback(
    (file: File | null) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const data = parseCSV(text);
        setParsed(data);
        setColumnMapping(autoMapColumns(data.headers, fields));
      };
      reader.readAsText(file);
    },
    [fields],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
        handleFileChange(file);
      }
    },
    [handleFileChange],
  );

  const handleMappingChange = (colIdx: number, fieldKey: string) => {
    setColumnMapping((prev) => {
      const next = { ...prev };
      if (fieldKey === '') {
        delete next[colIdx];
      } else {
        next[colIdx] = fieldKey;
      }
      return next;
    });
  };

  // Build mapped rows from parsed data + column mapping
  const getMappedRows = (): Record<string, string>[] => {
    if (!parsed) return [];
    return parsed.rows.map((row) => {
      const mapped: Record<string, string> = {};
      for (const [colIdxStr, fieldKey] of Object.entries(columnMapping)) {
        const colIdx = parseInt(colIdxStr, 10);
        if (row[colIdx] !== undefined && row[colIdx] !== '') {
          mapped[fieldKey] = row[colIdx];
        }
      }
      return mapped;
    });
  };

  const handleImport = async () => {
    const mappedRows = getMappedRows();
    if (mappedRows.length === 0) return;

    setImporting(true);
    setError('');
    setProgress({ done: 0, total: mappedRows.length });

    try {
      const res = await fetch('/api/admin/batch-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, rows: mappedRows }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Import failed');
      }

      const data: ImportResult = await res.json();
      setResult(data);
      setProgress({ done: data.created + data.errors.length, total: mappedRows.length });

      if (data.created > 0) {
        onSuccess();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setImporting(false);
    }
  };

  const mappedFieldKeys = new Set(Object.values(columnMapping));
  const previewRows = parsed?.rows.slice(0, 10) ?? [];
  const mappedColumnIndices = Object.entries(columnMapping)
    .filter(([, v]) => v !== '')
    .map(([k]) => parseInt(k, 10));

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay"
        onClick={importing ? undefined : onClose}
      />

      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl shadow-stone-900/10 w-full max-w-2xl animate-dialog ring-1 ring-stone-900/5 max-h-[85vh] flex flex-col dark:bg-stone-900">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4 shrink-0">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-400" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-500/15 dark:to-amber-500/5 flex items-center justify-center ring-1 ring-amber-200/60 dark:ring-amber-400/20">
                <FileSpreadsheet className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-stone-900 leading-tight dark:text-stone-100">
                  Batch Import {entityLabel}
                </h2>
                <p className="text-xs text-stone-400 mt-0.5 dark:text-stone-500">
                  Paste from spreadsheet or upload CSV
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={importing}
              className="p-1.5 -mr-1 rounded-lg text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors cursor-pointer disabled:opacity-50 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Result screen */}
        {result ? (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 ring-4 ring-emerald-100/60 dark:ring-emerald-500/10 flex items-center justify-center mx-auto mb-4 animate-scale-in dark:bg-emerald-500/10">
              <CheckCircle2 className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
            </div>
            <p className="text-lg font-semibold text-stone-900 dark:text-stone-100">Import Complete</p>
            <p className="text-sm text-stone-500 mt-1 dark:text-stone-400">
              {result.created} row{result.created !== 1 ? 's' : ''} created
              {result.errors.length > 0 && (
                <span className="text-red-500 dark:text-red-400">
                  , {result.errors.length} error{result.errors.length !== 1 ? 's' : ''}
                </span>
              )}
            </p>
            {result.errors.length > 0 && (
              <div className="mt-4 max-h-32 overflow-y-auto text-left bg-red-50 rounded-lg border border-red-200/60 p-3 dark:bg-red-500/10 dark:border-red-400/20">
                {result.errors.map((err, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs text-red-700 py-0.5 dark:text-red-300">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>
                      Row {err.row}: {err.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-6 px-5 py-2 text-sm font-semibold text-white bg-gold-500 hover:bg-gold-600 rounded-xl shadow-sm transition-all cursor-pointer"
              style={{ backgroundColor: 'var(--gold-500, #d4a843)' }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex border-b border-stone-200 px-5 shrink-0 dark:border-stone-700">
              <button
                type="button"
                onClick={() => {
                  setTab('paste');
                  setParsed(null);
                  setColumnMapping({});
                }}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  tab === 'paste'
                    ? 'border-amber-500 text-amber-700 dark:text-amber-300'
                    : 'border-transparent text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300'
                }`}
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Paste from Spreadsheet
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('csv');
                  setPasteText('');
                  setParsed(null);
                  setColumnMapping({});
                }}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
                  tab === 'csv'
                    ? 'border-amber-500 text-amber-700 dark:text-amber-300'
                    : 'border-transparent text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                CSV Upload
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Tab: Paste */}
              {tab === 'paste' && (
                <div>
                  <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-1.5 block dark:text-stone-500">
                    Paste tab-separated data (include header row)
                  </label>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={"Name\tStatus\tDate\nRow 1\tActive\t2024-01-01\nRow 2\tInactive\t2024-02-15"}
                    className="w-full min-h-[200px] px-3 py-2 bg-[var(--subtle-bg,#fafaf9)] border border-[var(--border-color,#e7e5e4)] rounded-lg font-mono text-xs text-stone-800 placeholder:text-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-400/20 focus:border-amber-400 transition-all duration-150 resize-y dark:text-stone-100"
                  />
                </div>
              )}

              {/* Tab: CSV */}
              {tab === 'csv' && !parsed && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center gap-3 min-h-[200px] rounded-lg border-2 border-dashed transition-colors cursor-pointer ${
                    dragOver
                      ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-500/10'
                      : 'border-stone-300 hover:border-stone-400 bg-[var(--subtle-bg,#fafaf9)] dark:border-stone-600 dark:hover:border-stone-500'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center dark:bg-stone-700">
                    <Upload className="w-5 h-5 text-stone-400 dark:text-stone-500" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-stone-600 dark:text-stone-300">
                      Drop CSV or click to upload
                    </p>
                    <p className="text-xs text-stone-400 mt-0.5 dark:text-stone-500">.csv files only</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="sr-only"
                    onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                  />
                </div>
              )}

              {/* Column mapping */}
              {parsed && parsed.headers.length > 0 && (
                <div>
                  <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-2 block dark:text-stone-500">
                    Column Mapping
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {parsed.headers.map((header, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 bg-stone-50 rounded-lg px-3 py-2 border border-stone-100 dark:bg-stone-800 dark:border-stone-800"
                      >
                        <span className="text-xs font-medium text-stone-600 truncate min-w-0 flex-1 dark:text-stone-300">
                          {header}
                        </span>
                        <span className="text-stone-300 text-xs shrink-0 dark:text-stone-600">&rarr;</span>
                        <select
                          value={columnMapping[idx] ?? ''}
                          onChange={(e) => handleMappingChange(idx, e.target.value)}
                          className="text-xs bg-white border border-stone-200 rounded-md px-2 py-1 text-stone-700 focus:outline-none focus:ring-1 focus:ring-amber-400 min-w-[120px] cursor-pointer dark:bg-stone-900 dark:border-stone-700 dark:text-stone-200"
                        >
                          <option value="">-- Skip --</option>
                          {fields.map((f) => (
                            <option
                              key={f.key}
                              value={f.key}
                              disabled={mappedFieldKeys.has(f.key) && columnMapping[idx] !== f.key}
                            >
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview table */}
              {parsed && previewRows.length > 0 && mappedColumnIndices.length > 0 && (
                <div>
                  <label className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider mb-2 block dark:text-stone-500">
                    Preview ({parsed.rows.length} row{parsed.rows.length !== 1 ? 's' : ''} total
                    {parsed.rows.length > 10 ? ', showing first 10' : ''})
                  </label>
                  <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-stone-50 dark:bg-stone-800">
                          {mappedColumnIndices.map((colIdx) => {
                            const fieldKey = columnMapping[colIdx];
                            const field = fields.find((f) => f.key === fieldKey);
                            return (
                              <th
                                key={colIdx}
                                className="px-3 py-2 text-left font-semibold text-stone-500 border-b border-stone-200 dark:border-stone-700 dark:text-stone-400"
                              >
                                {field?.label ?? fieldKey}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, rowIdx) => (
                          <tr
                            key={rowIdx}
                            className={rowIdx % 2 === 0 ? 'bg-white dark:bg-stone-900' : 'bg-stone-50/50 dark:bg-stone-800/40'}
                          >
                            {mappedColumnIndices.map((colIdx) => (
                              <td
                                key={colIdx}
                                className="px-3 py-1.5 text-stone-700 border-b border-stone-100 truncate max-w-[200px] dark:border-stone-800 dark:text-stone-200"
                              >
                                {row[colIdx] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Importing progress */}
              {importing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
                    <span>Importing...</span>
                    <span>
                      {progress.done}/{progress.total} rows
                    </span>
                  </div>
                  <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden dark:bg-stone-700">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                        backgroundColor: 'var(--gold-500, #d4a843)',
                      }}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200/60 dark:bg-red-500/10 dark:text-red-300 dark:border-red-400/20">
                  <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-stone-100 bg-stone-50/60 flex items-center justify-end gap-2.5 shrink-0 dark:bg-stone-800/40 dark:border-stone-800">
              <button
                type="button"
                onClick={onClose}
                disabled={importing}
                className="px-4 py-2 text-sm font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={
                  importing ||
                  !parsed ||
                  parsed.rows.length === 0 ||
                  mappedColumnIndices.length === 0
                }
                className="px-5 py-2 text-sm font-semibold text-white rounded-xl shadow-sm transition-all cursor-pointer disabled:opacity-40 disabled:shadow-none"
                style={{ backgroundColor: 'var(--gold-500, #d4a843)' }}
              >
                {importing ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Importing...
                  </span>
                ) : parsed?.rows.length ? (
                  `Import ${parsed.rows.length} row${parsed.rows.length !== 1 ? 's' : ''}`
                ) : (
                  'Import'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
