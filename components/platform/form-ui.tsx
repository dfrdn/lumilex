'use client';

import { useRef, useState } from 'react';
import { ChevronDown, Loader2, Save } from 'lucide-react';
import CellDropdown from '@/components/admin/CellDropdown';

/**
 * The operator surface's form primitives.
 *
 * Its own set rather than the firm surfaces': those sit inside a role shell
 * that has already painted a tenant's palette, and this one deliberately has no
 * firm. The shapes match (same borders, same uppercase micro-labels) so the two
 * read as one product, but nothing here reads `BrandProvider`.
 */

export function Panel({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
      <header className="px-5 pt-5">
        <h2 className="font-serif text-lg text-foreground tracking-tight">{title}</h2>
        {description && (
          <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{description}</p>
        )}
      </header>
      <div className="p-5 space-y-4">{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-[var(--border-color)] flex items-center gap-3">
          {footer}
        </div>
      )}
    </section>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
      {children}
    </span>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  mono,
  type = 'text',
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  mono?: boolean;
  type?: 'text' | 'password';
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300 disabled:opacity-60 ${
          mono ? 'font-mono' : ''
        }`}
      />
      {hint && <span className="block text-[11px] text-[var(--text-muted)] mt-1">{hint}</span>}
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: React.ReactNode;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300"
      />
      {hint && <span className="block text-[11px] text-[var(--text-muted)] mt-1">{hint}</span>}
    </label>
  );
}

/** A hex colour, editable as a swatch and as text. Both stay in step. */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-12 shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--background)] p-1 cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#0F2A44"
          className={`w-full px-3 py-2 text-sm font-mono rounded-lg bg-[var(--background)] border text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300 ${
            value && !valid ? 'border-amber-500/60' : 'border-[var(--border-color)]'
          }`}
        />
      </div>
      {value && !valid && (
        <span className="block text-[11px] text-amber-700 dark:text-amber-400 mt-1">
          Use a 6-digit hex colour, e.g. #0F2A44
        </span>
      )}
    </div>
  );
}

export interface SelectOption {
  id: string;
  label: string;
  sublabel?: string;
}

/** Single-select on CellDropdown — no native `<select>`, per the style rule. */
export function Select({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  hint?: React.ReactNode;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value);

  return (
    <div>
      <Label>{label}</Label>
      <button
        type="button"
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-foreground text-left focus:outline-none focus:ring-1 focus:ring-gold-300"
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={options}
          onSelect={(id) => {
            if (id) onChange(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          anchorRef={anchor}
          minWidth={320}
        />
      )}
      {hint && <span className="block text-[11px] text-[var(--text-muted)] mt-1">{hint}</span>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-emerald-600' : 'bg-[var(--border-color)]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function SaveButton({
  onClick,
  saving,
  dirty,
  children = 'Save changes',
}: {
  onClick: () => void;
  saving: boolean;
  dirty: boolean;
  children?: React.ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={!dirty || saving}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? 'Saving…' : children}
      </button>
      {dirty && !saving && (
        <span className="text-xs text-[var(--text-muted)]">Unsaved changes</span>
      )}
    </>
  );
}

/** A warning the operator should read before acting, not after. */
export function Caution({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
      {children}
    </p>
  );
}

export async function postJson(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Every /api/platform handler answers with JSON, success or failure. Anything
  // else means the request never reached one: proxy.ts redirects an expired or
  // non-operator session to a sign-in page and fetch follows that redirect, so
  // what arrives here is a 200 carrying HTML. Parsing it yields {} and reads as
  // success, and the caller then sets its state from fields that are not there
  // — a TypeError on the next render instead of a chance to sign in again.
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new Error(
      res.ok
        ? 'Your session has expired or is no longer an operator — reload the page and sign in again.'
        : `Request failed (${res.status})`,
    );
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const details = Array.isArray(json.details) ? ` — ${(json.details as string[]).join('; ')}` : '';
    throw new Error(`${(json.error as string) || `Request failed (${res.status})`}${details}`);
  }
  return json;
}
