'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Users } from 'lucide-react';

interface LawyerOption {
  personId: string;
  name: string;
  position: string;
}

interface Props {
  lawyers: LawyerOption[];
  selected: string;
  basePath?: string;
  paramName?: string;
  firmLabel?: string;
}

export default function LawyerSelector({
  lawyers,
  selected,
  basePath = '/admin/team-dashboard',
  paramName = 'lawyer',
  firmLabel = 'Firm-wide',
}: Props) {
  const router = useRouter();
  const params = useSearchParams();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const next = new URLSearchParams(params?.toString() ?? '');
    if (value === 'firm') next.delete(paramName);
    else next.set(paramName, value);
    const qs = next.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <Users className="w-4 h-4 text-[var(--text-muted)]" />
      <span className="text-[var(--text-secondary)]">Viewing:</span>
      <select
        value={selected}
        onChange={onChange}
        className="bg-card border border-[var(--border-color)] rounded-md px-2.5 py-1.5 text-sm font-medium text-foreground hover:border-[var(--border-hover)] focus:outline-none focus:ring-2 focus:ring-gold-400/40 transition-colors"
      >
        <option value="firm">{firmLabel}</option>
        {lawyers.map((l) => (
          <option key={l.personId} value={l.personId}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
