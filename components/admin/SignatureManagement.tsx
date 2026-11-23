'use client';

import { useState, useRef } from 'react';
import useSWR from 'swr';
import {
  Loader2,
  PenTool,
  Upload,
  Trash2,
  X,
  Check,
} from 'lucide-react';

interface TeamMember {
  person_id: string;
  name: string;
  position: string;
  active: boolean;
  signature_url: string;
}

export default function SignatureManagement() {
  const { data: sigData, isLoading: loading, mutate } = useSWR<{ data: TeamMember[] }>('/api/admin/signatures');
  const members = sigData?.data ?? [];

  // Modal
  const [selected, setSelected] = useState<TeamMember | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function openModal(member: TeamMember) {
    setSelected(member);
    setSignatureFile(null);
    setSignaturePreview(null);
    setError('');

    if (member.signature_url) {
      try {
        const res = await fetch('/api/file-sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: [member.signature_url] }),
        });
        if (res.ok) {
          const json = await res.json();
          const url = json.urls?.[member.signature_url];
          if (url) setSignaturePreview(url);
        }
      } catch { /* ignore */ }
    }
  }

  function closeModal() {
    setSelected(null);
    setSignaturePreview(null);
    setSignatureFile(null);
    setError('');
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!signatureFile || !selected) return;

    setSaving(true);
    setError('');

    try {
      const fd = new FormData();
      fd.append('personId', selected.person_id);
      fd.append('file', signatureFile);

      const res = await fetch('/api/admin/signatures', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Upload failed');

      mutate(); // Revalidate member list from server
      closeModal();
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;

    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/admin/signatures', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: selected.person_id }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Delete failed');
      }

      mutate(); // Revalidate member list from server
      closeModal();
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  const withSignature = members.filter((m) => m.signature_url);
  const withoutSignature = members.filter((m) => !m.signature_url);

  return (
    <div>
      {/* Stats */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            {withSignature.length} uploaded
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <PenTool className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
            {withoutSignature.length} missing
          </span>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {members.map((member) => (
          <button
            key={member.person_id}
            onClick={() => openModal(member)}
            className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all duration-150 cursor-pointer ${
              member.signature_url
                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                : 'border-[var(--border-color)] bg-card hover:bg-[var(--subtle-bg)]'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${
                member.signature_url
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-[var(--subtle-bg)] text-[var(--text-muted)]'
              }`}
            >
              {member.name
                .split(' ')
                .map((w) => w[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {member.name}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{member.position}</p>
            </div>
            {member.signature_url ? (
              <Check className="w-4 h-4 text-emerald-500 shrink-0 dark:text-emerald-400" />
            ) : (
              <PenTool className="w-4 h-4 text-[var(--text-muted)] opacity-40 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="relative bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
            <button
              type="button"
              onClick={closeModal}
              className="absolute top-4 right-4 p-1 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors duration-150 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <form onSubmit={handleUpload}>
              <h2 className="font-serif text-lg font-semibold text-foreground mb-1">
                E-Signature
              </h2>
              <p className="text-sm text-[var(--text-muted)] mb-5">
                {selected.name} &middot; {selected.position}
              </p>

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
                    if (f) setSignaturePreview(URL.createObjectURL(f));
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

              {error && <p className="text-sm text-red-500 mt-3 dark:text-red-400">{error}</p>}

              <div className="flex justify-between mt-6">
                <div>
                  {selected.signature_url && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={saving}
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
                    disabled={saving || !signatureFile}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-gold-500 hover:bg-gold-600 text-white transition-colors duration-150 cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Upload
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
