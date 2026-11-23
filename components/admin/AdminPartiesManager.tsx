'use client';

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { Search, Scale, ChevronRight } from 'lucide-react';
import PartiesSection from '@/components/detail/PartiesSection';

interface MatterOption {
  id: string;
  name: string;
  clientName: string;
}

interface ClientsMattersResponse {
  clients?: { id: string; name: string }[];
  matters?: { id: string; name: string; clientId: string }[];
}

export default function AdminPartiesManager() {
  const { data, error } = useSWR<ClientsMattersResponse>('/api/clients-matters');
  const loading = !data && !error;
  const [search, setSearch] = useState('');
  const [selectedMatter, setSelectedMatter] = useState<MatterOption | null>(null);

  const matters = useMemo<MatterOption[]>(() => {
    const clientMap = new Map((data?.clients ?? []).map((c) => [c.id, c.name]));
    return (data?.matters ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      clientName: clientMap.get(m.clientId) ?? '',
    }));
  }, [data]);

  const filtered = matters.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.clientName.toLowerCase().includes(q);
  });

  if (selectedMatter) {
    return (
      <div>
        <button
          onClick={() => setSelectedMatter(null)}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] mb-4 transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
          Back to matters list
        </button>
        <div className="mb-4 px-4 py-3 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-[var(--text-muted)]" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">{selectedMatter.name}</span>
            <span className="text-xs text-[var(--text-muted)]">· {selectedMatter.clientName}</span>
          </div>
        </div>
        <PartiesSection matterId={selectedMatter.id} isAdmin={true} />
      </div>
    );
  }

  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search matters by name or client..."
          className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-navy-500/30"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-navy-300 dark:border-navy-700 border-t-navy-600 dark:border-t-navy-300 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] divide-y divide-[var(--border-color)] overflow-hidden">
          {filtered.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-[var(--text-muted)]">
                {search ? 'No matters match your search' : 'No matters found'}
              </p>
            </div>
          ) : (
            filtered.map((matter) => (
              <button
                key={matter.id}
                onClick={() => setSelectedMatter(matter)}
                className="w-full text-left px-5 py-3.5 flex items-center gap-3 hover:bg-[var(--bg-hover)] transition-colors group"
              >
                <Scale className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{matter.name}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{matter.clientName}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
