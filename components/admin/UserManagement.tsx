'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import {
  Search,
  X,
  Plus,
  Key,
  Loader2,
  Check,
  ChevronUp,
  ChevronDown,
  Pencil,
  PenTool,
  Trash2,
  Upload,
} from 'lucide-react';
import { USER_ROLES } from '@/lib/roles';

// ── Types ─────────────────────────────────────────────────────────

interface TeamMember {
  notion_id: string;
  person_id: string;
  name: string;
  initials: string;
  email: string;
  mobile_number: string;
  position: string;
  role: string;
  active: boolean;
  start_date: string | null;
  signature_url: string;
  monthly_salary: number | null;
}

type ModalMode = null | 'set-password' | 'add-user' | 'upload-signature';


const ROLE_COLORS: Record<string, string> = {
  super_user: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  partner: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  lawyer: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  admin: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  finance: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

function roleBadgeClass(role: string): string {
  return ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
}

// ── Inline Editable Cell ──────────────────────────────────────────

function EditableCell({
  value,
  personId,
  field,
  onSave,
}: {
  value: string;
  personId: string;
  field: string;
  onSave: (personId: string, field: string, value: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [editing, value]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(personId, field, trimmed);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }, [draft, value, personId, field, onSave]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="w-full px-2 py-1 text-sm rounded-md bg-background border border-gold-400 text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40 disabled:opacity-50"
        />
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)] shrink-0" />}
      </div>
    );
  }

  return (
    <div className="group/cell flex items-center gap-1.5 cursor-pointer" onClick={() => setEditing(true)}>
      <span className="text-sm text-foreground truncate">{value || '\u2014'}</span>
      {saved ? (
        <Check className="w-3 h-3 text-emerald-600 shrink-0 dark:text-emerald-400" />
      ) : (
        <Pencil className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0" />
      )}
    </div>
  );
}

// ── Salary cell (numeric, PHP-formatted, nullable) ────────────────

const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

function SalaryCell({
  value,
  personId,
  onSave,
}: {
  value: number | null;
  personId: string;
  onSave: (
    personId: string,
    field: string,
    value: number | null,
  ) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value == null ? '' : String(value));
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [editing, value]);

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    const nextValue: number | null =
      trimmed === '' ? null : Number(trimmed);
    if (nextValue !== null && (!Number.isFinite(nextValue) || nextValue < 0)) {
      return;
    }
    if (nextValue === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(personId, 'monthly_salary', nextValue);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }, [draft, value, personId, onSave]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)]">
            ₱
          </span>
          <input
            ref={inputRef}
            type="number"
            min={0}
            step="100"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            disabled={saving}
            className="w-full pl-5 pr-2 py-1 text-sm rounded-md bg-background border border-gold-400 text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40 disabled:opacity-50 tabular-nums text-right"
          />
        </div>
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)] shrink-0" />}
      </div>
    );
  }

  return (
    <div
      className="group/cell flex items-center gap-1.5 cursor-pointer justify-end"
      onClick={() => setEditing(true)}
    >
      <span className="text-sm text-foreground tabular-nums">
        {value == null ? '—' : PHP_FORMATTER.format(value)}
      </span>
      {saved ? (
        <Check className="w-3 h-3 text-emerald-600 shrink-0 dark:text-emerald-400" />
      ) : (
        <Pencil className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0" />
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────

export default function UserManagement() {
  const { data: membersData, error: membersError, mutate: mutateMembers } = useSWR<{ data?: TeamMember[] }>('/api/admin/users');
  const members = useMemo(() => membersData?.data ?? [], [membersData]);
  const loading = !membersData && !membersError;
  const setMembers = useCallback(
    (update: (prev: TeamMember[]) => TeamMember[]) =>
      mutateMembers((d) => ({ ...d, data: update(d?.data ?? []) }), { revalidate: false }),
    [mutateMembers],
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Role update states
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [savedRole, setSavedRole] = useState<string | null>(null);

  // Modal
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [modalTarget, setModalTarget] = useState<TeamMember | null>(null);

  // Modal form fields
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPosition, setFormPosition] = useState('');
  const [formRole, setFormRole] = useState<string>('lawyer');
  const [formPassword, setFormPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [formSaving, setFormSaving] = useState(false);

  // Signature states
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // ── Fetch ──────────────────────────────────────────────────────

  function fetchMembers() {
    void mutateMembers();
  }

  // ── Search & Sort ──────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.position.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q) ||
        (m.initials ?? '').toLowerCase().includes(q) ||
        (m.mobile_number ?? '').toLowerCase().includes(q),
    );
  }, [members, searchQuery]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const va = (a as any)[sortKey];
      const vb = (b as any)[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      let cmp: number;
      if (typeof va === 'boolean') {
        cmp = (va ? 1 : 0) - (vb ? 1 : 0);
      } else if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(col: string) {
    if (sortKey === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col);
      setSortDir('asc');
    }
  }

  // ── Field Update (generic) ──────────────────────────────────────

  const handleFieldSave = useCallback(async (personId: string, field: string, value: string | boolean | number | null): Promise<boolean> => {
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, field, value }),
      });
      if (!res.ok) throw new Error('Update failed');

      // Update local state
      setMembers((prev) =>
        prev.map((m) =>
          m.person_id === personId ? { ...m, [field]: value } : m,
        ),
      );
      return true;
    } catch (err) {
      console.error(`Failed to update ${field}:`, err);
      return false;
    }
  }, [setMembers]);

  // ── Role Change ────────────────────────────────────────────────

  async function handleRoleChange(member: TeamMember, newRole: string) {
    if (newRole === member.role) return;
    const key = member.person_id;
    setSavingRole(key);

    const ok = await handleFieldSave(member.person_id, 'role', newRole);
    if (ok) {
      setSavedRole(key);
      setTimeout(() => setSavedRole(null), 1500);
    }
    setSavingRole(null);
  }

  // ── Active Toggle ──────────────────────────────────────────────

  async function handleActiveToggle(member: TeamMember) {
    await handleFieldSave(member.person_id, 'active', !member.active);
  }

  // ── Modal Open Helpers ─────────────────────────────────────────

  function openSetPassword(member: TeamMember) {
    setModalTarget(member);
    setFormEmail(member.email);
    setFormPassword('');
    setFormError('');
    setModalMode('set-password');
  }

  function openAddUser() {
    setModalTarget(null);
    setFormName('');
    setFormEmail('');
    setFormPosition('');
    setFormRole('lawyer');
    setFormPassword('');
    setFormError('');
    setModalMode('add-user');
  }

  async function openSignatureModal(member: TeamMember) {
    setModalTarget(member);
    setFormError('');
    setSignatureFile(null);
    setSignaturePreview(null);
    setModalMode('upload-signature');

    // Load existing signature preview if exists
    if (member.signature_url) {
      try {
        const res = await fetch('/api/file-sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: [member.signature_url] }),
        });
        if (res.ok) {
          const json = await res.json();
          const url = json.urls?.[member.signature_url] ?? json[member.signature_url];
          if (url) setSignaturePreview(url);
        }
      } catch { /* ignore */ }
    }
  }

  function closeModal() {
    setModalMode(null);
    setModalTarget(null);
    setFormError('');
    setSignaturePreview(null);
    setSignatureFile(null);
  }

  // ── Set Password Submit ────────────────────────────────────────

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!formPassword || formPassword.length < 6) {
      setFormError('Password must be at least 6 characters');
      return;
    }

    setFormSaving(true);
    setFormError('');

    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formEmail, password: formPassword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to set password');
      closeModal();
    } catch (err: any) {
      setFormError(err.message ?? 'Something went wrong');
    } finally {
      setFormSaving(false);
    }
  }

  // ── Add User Submit ────────────────────────────────────────────

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Name is required');
      return;
    }
    if (!formEmail.trim()) {
      setFormError('Email is required');
      return;
    }
    if (!formPassword || formPassword.length < 6) {
      setFormError('Password must be at least 6 characters');
      return;
    }

    setFormSaving(true);
    setFormError('');

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName.trim(),
          email: formEmail.trim(),
          position: formPosition.trim(),
          role: formRole,
          password: formPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to add user');
      closeModal();
      fetchMembers();
    } catch (err: any) {
      setFormError(err.message ?? 'Something went wrong');
    } finally {
      setFormSaving(false);
    }
  }

  // ── Signature Upload ─────────────────────────────────────────

  async function handleSignatureUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!signatureFile || !modalTarget) return;

    setFormSaving(true);
    setFormError('');

    try {
      const fd = new FormData();
      fd.append('personId', modalTarget.person_id);
      fd.append('file', signatureFile);

      const res = await fetch('/api/admin/signatures', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Upload failed');

      // Update local state
      setMembers((prev) =>
        prev.map((m) =>
          m.person_id === modalTarget.person_id
            ? { ...m, signature_url: json.signatureUrl }
            : m,
        ),
      );
      closeModal();
    } catch (err: any) {
      setFormError(err.message ?? 'Something went wrong');
    } finally {
      setFormSaving(false);
    }
  }

  async function handleSignatureDelete() {
    if (!modalTarget) return;

    setFormSaving(true);
    setFormError('');

    try {
      const res = await fetch('/api/admin/signatures', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: modalTarget.person_id }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Delete failed');
      }

      setMembers((prev) =>
        prev.map((m) =>
          m.person_id === modalTarget.person_id ? { ...m, signature_url: '' } : m,
        ),
      );
      closeModal();
    } catch (err: any) {
      setFormError(err.message ?? 'Something went wrong');
    } finally {
      setFormSaving(false);
    }
  }

  // ── Sortable Header ────────────────────────────────────────────

  function SortHeader({ col, label, className }: { col: string; label: string; className?: string }) {
    const isSorted = sortKey === col;
    return (
      <th
        className={`sticky top-0 bg-background z-10 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)] cursor-pointer select-none hover:text-foreground transition-colors duration-150 ${className ?? ''}`}
        onClick={() => toggleSort(col)}
      >
        <span className="flex items-center gap-1">
          {label}
          {isSorted &&
            (sortDir === 'asc' ? (
              <ChevronUp className="w-3 h-3 text-gold-500 dark:text-gold-400" />
            ) : (
              <ChevronDown className="w-3 h-3 text-gold-500 dark:text-gold-400" />
            ))}
        </span>
      </th>
    );
  }

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div>
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <p className="text-sm text-[var(--text-secondary)]">
          <span className="font-semibold text-foreground tabular-nums">
            {sorted.length}
          </span>{' '}
          Team Members
        </p>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search users..."
              className="pl-8 pr-7 py-1.5 text-sm rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40 w-48 sm:w-56 transition-all duration-150"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-foreground cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Add User button */}
          <button
            type="button"
            onClick={openAddUser}
            className="inline-flex items-center gap-1.5 bg-gold-500 hover:bg-gold-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors duration-150 cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add User
          </button>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <SortHeader col="name" label="Name" />
              <SortHeader col="initials" label="Initials" />
              <SortHeader col="email" label="Email" />
              <SortHeader col="mobile_number" label="Mobile" />
              <SortHeader col="position" label="Position" />
              <SortHeader col="role" label="Role" />
              <SortHeader col="start_date" label="Start Date" />
              <SortHeader col="monthly_salary" label="Monthly Salary" />
              <SortHeader col="active" label="Active" />
              <th className="sticky top-0 bg-background z-10 px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)] w-52">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-12 text-center text-sm text-[var(--text-muted)]"
                >
                  No team members found
                </td>
              </tr>
            ) : (
              sorted.map((member) => {
                const isSaving = savingRole === member.person_id;
                const isSaved = savedRole === member.person_id;

                return (
                  <tr
                    key={member.notion_id}
                    className="group hover:bg-[var(--subtle-bg)] transition-colors duration-100"
                  >
                    {/* Name (editable) */}
                    <td className="px-3 py-2 border-b border-[var(--border-color)] font-medium">
                      <EditableCell
                        value={member.name}
                        personId={member.person_id}
                        field="name"
                        onSave={handleFieldSave}
                      />
                    </td>

                    {/* Initials (editable) */}
                    <td className="px-3 py-2 border-b border-[var(--border-color)]">
                      <EditableCell
                        value={member.initials ?? ''}
                        personId={member.person_id}
                        field="initials"
                        onSave={handleFieldSave}
                      />
                    </td>

                    {/* Email (editable) */}
                    <td className="px-3 py-2 border-b border-[var(--border-color)]">
                      <EditableCell
                        value={member.email}
                        personId={member.person_id}
                        field="email"
                        onSave={handleFieldSave}
                      />
                    </td>

                    {/* Mobile Number (editable) */}
                    <td className="px-3 py-2 border-b border-[var(--border-color)]">
                      <EditableCell
                        value={member.mobile_number ?? ''}
                        personId={member.person_id}
                        field="mobile_number"
                        onSave={handleFieldSave}
                      />
                    </td>

                    {/* Position (editable) */}
                    <td className="px-3 py-2 border-b border-[var(--border-color)]">
                      <EditableCell
                        value={member.position}
                        personId={member.person_id}
                        field="position"
                        onSave={handleFieldSave}
                      />
                    </td>

                    {/* Role dropdown */}
                    <td className="px-3 py-2 border-b border-[var(--border-color)]">
                      <div className="flex items-center gap-2">
                        {isSaving ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />
                        ) : isSaved ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : null}
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member, e.target.value)}
                          disabled={isSaving}
                          className={`text-xs font-medium px-2.5 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gold-400 appearance-none pr-6 ${roleBadgeClass(member.role)}`}
                          style={{
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 6px center',
                          }}
                        >
                          {USER_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r.replace(/_/g, ' ')}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>

                    {/* Start Date (editable) */}
                    <td className="px-3 py-2 border-b border-[var(--border-color)]">
                      <EditableCell
                        value={member.start_date ?? ''}
                        personId={member.person_id}
                        field="start_date"
                        onSave={handleFieldSave}
                      />
                    </td>

                    {/* Monthly Salary (editable, MP/super_user only) */}
                    <td className="px-3 py-2 border-b border-[var(--border-color)]">
                      <SalaryCell
                        value={member.monthly_salary == null ? null : Number(member.monthly_salary)}
                        personId={member.person_id}
                        onSave={handleFieldSave}
                      />
                    </td>

                    {/* Active toggle */}
                    <td className="px-3 py-2 border-b border-[var(--border-color)]">
                      <button
                        onClick={() => handleActiveToggle(member)}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors duration-150 ${
                          member.active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        {member.active ? 'Active' : 'Inactive'}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2 border-b border-[var(--border-color)] text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openSignatureModal(member)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors duration-150 cursor-pointer ${
                            member.signature_url
                              ? 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-400 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30'
                              : 'border-[var(--border-color)] text-[var(--text-secondary)] bg-background hover:bg-[var(--subtle-bg)]'
                          }`}
                        >
                          <PenTool className="w-3 h-3" />
                          {member.signature_url ? 'Signed' : 'Signature'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openSetPassword(member)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] bg-background hover:bg-[var(--subtle-bg)] transition-colors duration-150 cursor-pointer"
                        >
                          <Key className="w-3 h-3" />
                          Password
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Modal Overlay ────────────────────────────────────── */}
      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Dialog */}
          <div className="relative bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            {/* Close */}
            <button
              type="button"
              onClick={closeModal}
              className="absolute top-4 right-4 p-1 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors duration-150 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            {/* ── Set Password Modal ──────────────────────────── */}
            {modalMode === 'set-password' && (
              <form onSubmit={handleSetPassword}>
                <h2 className="font-serif text-lg font-semibold text-foreground mb-1">
                  Set Password
                </h2>
                <p className="text-sm text-[var(--text-muted)] mb-5">
                  Set a new login password for {modalTarget?.name}
                </p>

                <div className="space-y-4">
                  {/* Email (read-only) */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      Email
                    </label>
                    <input
                      type="email"
                      value={formEmail}
                      readOnly
                      className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)] text-[var(--text-muted)] cursor-not-allowed"
                    />
                  </div>

                  {/* Password */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-300"
                      autoFocus
                    />
                  </div>
                </div>

                {formError && (
                  <p className="text-sm text-red-500 mt-3 dark:text-red-400">{formError}</p>
                )}

                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-sm font-medium rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] bg-background hover:bg-[var(--subtle-bg)] transition-colors duration-150 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-gold-500 hover:bg-gold-600 text-white transition-colors duration-150 cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    {formSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Set Password
                  </button>
                </div>
              </form>
            )}

            {/* ── Add User Modal ──────────────────────────────── */}
            {modalMode === 'add-user' && (
              <form onSubmit={handleAddUser}>
                <h2 className="font-serif text-lg font-semibold text-foreground mb-1">
                  Add Team Member
                </h2>
                <p className="text-sm text-[var(--text-muted)] mb-5">
                  Create a new team member account
                </p>

                <div className="space-y-4">
                  {/* Name */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="Juan Dela Cruz"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                      autoFocus
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      Email
                    </label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="name@yourfirm.com"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-300"
                    />
                  </div>

                  {/* Position */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      Position
                    </label>
                    <input
                      type="text"
                      value={formPosition}
                      onChange={(e) => setFormPosition(e.target.value)}
                      placeholder="Associate Attorney"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
                    />
                  </div>

                  {/* Role */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      Role
                    </label>
                    <select
                      value={formRole}
                      onChange={(e) => setFormRole(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-300 cursor-pointer"
                    >
                      {USER_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Password */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      Password
                    </label>
                    <input
                      type="password"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-background border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-300"
                    />
                  </div>
                </div>

                {formError && (
                  <p className="text-sm text-red-500 mt-3 dark:text-red-400">{formError}</p>
                )}

                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-sm font-medium rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] bg-background hover:bg-[var(--subtle-bg)] transition-colors duration-150 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={formSaving}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-gold-500 hover:bg-gold-600 text-white transition-colors duration-150 cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    {formSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Add User
                  </button>
                </div>
              </form>
            )}

            {/* ── Upload Signature Modal ──────────────────────── */}
            {modalMode === 'upload-signature' && (
              <form onSubmit={handleSignatureUpload}>
                <h2 className="font-serif text-lg font-semibold text-foreground mb-1">
                  E-Signature
                </h2>
                <p className="text-sm text-[var(--text-muted)] mb-5">
                  Upload a signature image for {modalTarget?.name}
                </p>

                {/* Current signature preview */}
                {signaturePreview && (
                  <div className="mb-4 p-4 rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)]">
                    <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                      Current Signature
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={signaturePreview}
                      alt="Current signature"
                      className="max-h-20 object-contain"
                    />
                  </div>
                )}

                {/* File upload */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                      Signature Image
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setSignatureFile(f);
                        if (f) {
                          setSignaturePreview(URL.createObjectURL(f));
                        }
                      }}
                      className="sr-only"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm rounded-lg border-2 border-dashed border-[var(--border-color)] text-[var(--text-secondary)] hover:border-gold-400 hover:text-gold-600 transition-colors duration-150 cursor-pointer dark:hover:text-gold-400"
                    >
                      <Upload className="w-4 h-4" />
                      {signatureFile ? signatureFile.name : 'Choose file (PNG recommended)'}
                    </button>
                    <p className="text-xs text-[var(--text-muted)] mt-1.5">
                      Use a PNG with transparent background for best results.
                    </p>
                  </div>
                </div>

                {formError && (
                  <p className="text-sm text-red-500 mt-3 dark:text-red-400">{formError}</p>
                )}

                <div className="flex justify-between mt-6">
                  {/* Delete button (only if signature exists) */}
                  <div>
                    {modalTarget?.signature_url && (
                      <button
                        type="button"
                        onClick={handleSignatureDelete}
                        disabled={formSaving}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors duration-150 cursor-pointer disabled:opacity-50 dark:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-4 py-2 text-sm font-medium rounded-xl border border-[var(--border-color)] text-[var(--text-secondary)] bg-background hover:bg-[var(--subtle-bg)] transition-colors duration-150 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={formSaving || !signatureFile}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-gold-500 hover:bg-gold-600 text-white transition-colors duration-150 cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      {formSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Upload
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
