"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Gavel,
  Lock,
  Plus,
  Trash2,
  Edit3,
  ChevronDown,
  Save,
  X,
  AlertTriangle,
  Loader2,
  BookOpen,
} from "lucide-react";
import Link from "next/link";
import { daysDisagree, type Provision } from "@/lib/rules/provisions";
import { confirmAction } from "@/components/ui/confirm";

/* ---------- types ---------- */

interface RuleDeadline {
  id: string;
  label: string;
  legal_basis: string;
  days_from_trigger: number;
  calendar_type: "calendar" | "business";
  depends_on: string | null;
  entity_type: "deliverable" | "hearing";
  hearing_type: string | null;
  is_reglementary: boolean;
  notes: string;
  sort_order: number;
}

interface RuleSet {
  id: string;
  name: string;
  trigger_event_label: string;
  applicable_matter_types: string[];
  is_system_default: boolean;
  created_by: string | null;
  rule_deadlines: RuleDeadline[];
}

/* ---------- helpers ---------- */

const MATTER_TYPES = ["Litigation", "Labor", "Tax"];

function emptyDeadline(): RuleDeadline {
  return {
    id: crypto.randomUUID(),
    label: "",
    legal_basis: "",
    days_from_trigger: 0,
    calendar_type: "calendar",
    depends_on: null,
    entity_type: "deliverable",
    hearing_type: null,
    is_reglementary: false,
    notes: "",
    sort_order: 0,
  };
}

function emptyRuleSet(): RuleSet {
  return {
    id: crypto.randomUUID(),
    name: "",
    trigger_event_label: "",
    applicable_matter_types: [],
    is_system_default: false,
    created_by: null,
    rule_deadlines: [emptyDeadline()],
  };
}

/** Convert a RuleSet into the camelCase body the API expects for POST/PATCH */
function toApiBody(rs: RuleSet, includeId: boolean) {
  const body: Record<string, unknown> = {
    name: rs.name,
    triggerEventLabel: rs.trigger_event_label,
    applicableMatterTypes: rs.applicable_matter_types,
    deadlines: rs.rule_deadlines.map((d) => ({
      id: d.id,
      label: d.label,
      legalBasis: d.legal_basis,
      daysFromTrigger: d.days_from_trigger,
      calendarType: d.calendar_type,
      dependsOn: d.depends_on,
      entityType: d.entity_type,
      hearingType: d.hearing_type,
      isReglementary: d.is_reglementary,
      notes: d.notes,
    })),
  };
  if (includeId) body.id = rs.id;
  return body;
}

/* ---------- component ---------- */

export default function RulesManagerClient() {
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  // The Rules of Court provisions each legal basis names, keyed by the basis text.
  const [provisions, setProvisions] = useState<Map<string, Provision[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<RuleSet | null>(null);
  const [isNew, setIsNew] = useState(false);

  /* ---- fetch ---- */

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      fetch("/api/court-rules")
        .then((r) => (r.ok ? r.json() : null))
        .then((json: { data?: { deadlines: { legalBasis: string; provisions: Provision[] }[] }[] } | null) => {
          if (!json?.data) return;
          const map = new Map<string, Provision[]>();
          for (const rs of json.data) for (const d of rs.deadlines) if (d.provisions?.length) map.set(d.legalBasis, d.provisions);
          setProvisions(map);
        })
        .catch(() => {});
      const res = await fetch("/api/partner/rules");
      if (!res.ok) throw new Error("Failed to load rule sets");
      const json = await res.json();
      setRuleSets(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  /* ---- save ---- */

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const method = isNew ? "POST" : "PATCH";
      const body = toApiBody(editing, !isNew);
      const res = await fetch("/api/partner/rules", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save rule set");
      }
      setEditing(null);
      setIsNew(false);
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  /* ---- delete ---- */

  const handleDelete = async (id: string) => {
    if (!(await confirmAction({ title: "Delete this rule set?", confirmLabel: "Delete", danger: true })))
      return;
    setError(null);
    try {
      const res = await fetch(`/api/partner/rules?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete rule set");
      await fetchRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  /* ---- editing helpers ---- */

  const updateEditing = (patch: Partial<RuleSet>) => {
    setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateDeadline = (index: number, patch: Partial<RuleDeadline>) => {
    if (!editing) return;
    const updated = [...editing.rule_deadlines];
    updated[index] = { ...updated[index], ...patch };
    updateEditing({ rule_deadlines: updated });
  };

  const addDeadline = () => {
    if (!editing) return;
    updateEditing({
      rule_deadlines: [
        ...editing.rule_deadlines,
        { ...emptyDeadline(), sort_order: editing.rule_deadlines.length },
      ],
    });
  };

  const removeDeadline = (index: number) => {
    if (!editing) return;
    updateEditing({
      rule_deadlines: editing.rule_deadlines.filter((_, i) => i !== index),
    });
  };

  const toggleMatterType = (type: string) => {
    if (!editing) return;
    const current = editing.applicable_matter_types;
    updateEditing({
      applicable_matter_types: current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type],
    });
  };

  /* ---- group rule sets by first matter type ---- */

  const grouped = ruleSets.reduce<Record<string, RuleSet[]>>((acc, rs) => {
    const key = rs.applicable_matter_types[0] ?? "Other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(rs);
    return acc;
  }, {});

  /* ================================================================== */
  /*  RENDER                                                             */
  /* ================================================================== */

  /* --- loading --- */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading rule sets...
      </div>
    );
  }

  /* --- error banner --- */
  const errorBanner = error && (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300 dark:border-red-400/30">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      {error}
    </div>
  );

  /* ---------- EDITOR VIEW ---------- */
  if (editing) {
    return (
      <div className="animate-fade-up space-y-6">
        {errorBanner}

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {isNew ? "New Rule Set" : `Edit: ${editing.name}`}
          </h2>
          <button
            onClick={() => {
              setEditing(null);
              setIsNew(false);
              setError(null);
            }}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--card-bg)]"
          >
            <X className="h-4 w-4" /> Cancel
          </button>
        </div>

        {/* --- main fields --- */}
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                Name
              </label>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => updateEditing({ name: e.target.value })}
                className="w-full rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500"
                placeholder="e.g. Standard Civil Litigation"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                Trigger Event Label
              </label>
              <input
                type="text"
                value={editing.trigger_event_label}
                onChange={(e) =>
                  updateEditing({ trigger_event_label: e.target.value })
                }
                className="w-full rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500"
                placeholder="e.g. Lawsuit filed"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
              Applicable Matter Types
            </label>
            <div className="flex flex-wrap gap-3">
              {MATTER_TYPES.map((mt) => (
                <label
                  key={mt}
                  className="inline-flex items-center gap-2 text-sm text-[var(--text-primary)]"
                >
                  <input
                    type="checkbox"
                    checked={editing.applicable_matter_types.includes(mt)}
                    onChange={() => toggleMatterType(mt)}
                    className="rounded border-[var(--border-color)] text-navy-600 focus:ring-navy-500 dark:text-navy-300"
                  />
                  {mt}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* --- deadlines --- */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text-secondary)]">
              Deadlines ({editing.rule_deadlines.length})
            </h3>
            <button
              onClick={addDeadline}
              className="inline-flex items-center gap-1 rounded-lg bg-navy-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-700"
            >
              <Plus className="h-3.5 w-3.5" /> Add Deadline
            </button>
          </div>

          {editing.rule_deadlines.map((dl, idx) => (
            <div
              key={dl.id}
              className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  Deadline #{idx + 1}
                </span>
                {editing.rule_deadlines.length > 1 && (
                  <button
                    onClick={() => removeDeadline(idx)}
                    className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-muted)]">
                    Label
                  </label>
                  <input
                    type="text"
                    value={dl.label}
                    onChange={(e) =>
                      updateDeadline(idx, { label: e.target.value })
                    }
                    className="w-full rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500"
                    placeholder="e.g. File Answer"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[var(--text-muted)]">
                    Legal Basis
                  </label>
                  <input
                    type="text"
                    value={dl.legal_basis}
                    onChange={(e) =>
                      updateDeadline(idx, { legal_basis: e.target.value })
                    }
                    className="w-full rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500"
                    placeholder="e.g. Rule 41, Sec. 3"
                  />
                  <ProvisionNotes provisions={provisions.get(dl.legal_basis)} days={dl.days_from_trigger} />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[var(--text-muted)]">
                    Days from Trigger
                  </label>
                  <input
                    type="number"
                    value={dl.days_from_trigger}
                    onChange={(e) =>
                      updateDeadline(idx, {
                        days_from_trigger: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[var(--text-muted)]">
                    Calendar Type
                  </label>
                  <select
                    value={dl.calendar_type}
                    onChange={(e) =>
                      updateDeadline(idx, {
                        calendar_type: e.target.value as
                          | "calendar"
                          | "business",
                      })
                    }
                    className="w-full rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500"
                  >
                    <option value="calendar">Calendar days</option>
                    <option value="business">Business days</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[var(--text-muted)]">
                    Entity Type
                  </label>
                  <select
                    value={dl.entity_type}
                    onChange={(e) =>
                      updateDeadline(idx, {
                        entity_type: e.target.value as
                          | "deliverable"
                          | "hearing",
                      })
                    }
                    className="w-full rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500"
                  >
                    <option value="deliverable">Deliverable</option>
                    <option value="hearing">Hearing</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <input
                      type="checkbox"
                      checked={dl.is_reglementary}
                      onChange={(e) =>
                        updateDeadline(idx, {
                          is_reglementary: e.target.checked,
                        })
                      }
                      className="rounded border-[var(--border-color)] text-navy-600 focus:ring-navy-500 dark:text-navy-300"
                    />
                    Reglementary
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--text-muted)]">
                  Notes
                </label>
                <textarea
                  value={dl.notes}
                  onChange={(e) =>
                    updateDeadline(idx, { notes: e.target.value })
                  }
                  rows={2}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500"
                  placeholder="Optional notes..."
                />
              </div>
            </div>
          ))}
        </div>

        {/* --- save --- */}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => {
              setEditing(null);
              setIsNew(false);
              setError(null);
            }}
            className="rounded-lg border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--card-bg)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-navy-600 px-4 py-2 text-sm font-medium text-white hover:bg-navy-700 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? "Saving..." : "Save Rule Set"}
          </button>
        </div>
      </div>
    );
  }

  /* ---------- LIST VIEW ---------- */
  return (
    <div className="animate-fade-up space-y-6">
      {errorBanner}

      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">
          {ruleSets.length} rule set{ruleSets.length !== 1 && "s"}
        </p>
        <button
          onClick={() => {
            setEditing(emptyRuleSet());
            setIsNew(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-navy-600 px-4 py-2 text-sm font-medium text-white hover:bg-navy-700"
        >
          <Plus className="h-4 w-4" /> Add Rule Set
        </button>
      </div>

      {Object.keys(grouped).length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--border-color)] py-16 text-center text-sm text-[var(--text-muted)]">
          <Gavel className="mx-auto mb-2 h-8 w-8 opacity-40" />
          No rule sets yet. Create one to get started.
        </div>
      )}

      {Object.entries(grouped).map(([matterType, sets]) => (
        <div key={matterType} className="space-y-3">
          <div className="flex items-center gap-2">
            <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--text-secondary)]">
              {matterType}
            </h3>
            <span className="text-xs text-[var(--text-muted)]">
              ({sets.length})
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((rs) => (
              <div
                key={rs.id}
                className="group rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] p-4 transition-shadow hover:shadow-md"
              >
                <div className="mb-2 flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-[var(--text-primary)]">
                        {rs.name}
                      </span>
                      {rs.is_system_default && (
                        <Lock className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-muted)]" />
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                      {rs.trigger_event_label}
                    </p>
                  </div>
                </div>

                <ul className="mt-2 space-y-1.5">
                  {rs.rule_deadlines.map((dl) => {
                    const provs = provisions.get(dl.legal_basis) ?? [];
                    const off = daysDisagree(dl.days_from_trigger, provs);
                    return (
                      <li key={dl.id} className="text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[var(--text-secondary)] truncate">{dl.label}</span>
                          <span className="font-mono text-[var(--text-muted)] shrink-0">{dl.days_from_trigger}d</span>
                        </div>
                        {dl.legal_basis && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {provs[0] ? (
                              <Link href={provs[0].href} className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-gold-600 dark:hover:text-gold-400 underline-offset-2 hover:underline" title={`${provs[0].citation} — ${provs[0].title}`}>
                                <BookOpen className="h-3 w-3" /> {dl.legal_basis}
                              </Link>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]"><BookOpen className="h-3 w-3" /> {dl.legal_basis}</span>
                            )}
                            {off && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400" title={provs.map((p) => `${p.citation}: ${p.days.join('/')} days`).join('; ')}>
                                <AlertTriangle className="h-3 w-3" /> rule says {[...new Set(provs.flatMap((p) => p.days))].join(' or ')} days
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {!rs.is_system_default && (
                  <div className="mt-3 flex items-center gap-2 border-t border-[var(--border-color)] pt-3">
                    <button
                      onClick={() => {
                        setEditing(rs);
                        setIsNew(false);
                        setError(null);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-navy-50 hover:text-navy-600 dark:hover:bg-navy-500/15 dark:hover:text-navy-200"
                    >
                      <Edit3 className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => handleDelete(rs.id)}
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:text-red-400 dark:hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The rule text behind a legal basis, under the input that names it. */
function ProvisionNotes({ provisions, days }: { provisions: Provision[] | undefined; days: number }) {
  if (!provisions || provisions.length === 0) return null;
  const off = daysDisagree(days, provisions);
  return (
    <div className="mt-2 space-y-2">
      {provisions.map((p) => (
        <div key={p.href} className="rounded-lg border border-[var(--border-color)] bg-[var(--subtle-bg)] px-3 py-2">
          <Link href={p.href} className="text-xs font-medium text-[var(--text-primary)] hover:text-gold-600 dark:hover:text-gold-400">
            {p.citation} — {p.title} <span className="font-normal text-[var(--text-muted)]">({p.sourceLabel})</span>
          </Link>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)] line-clamp-3">{p.excerpt}</p>
        </div>
      ))}
      {off && (
        <p className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" /> The rule text states {[...new Set(provisions.flatMap((p) => p.days))].join(' or ')} days; this deadline uses {days}.
        </p>
      )}
    </div>
  );
}
