import { Users } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import type { LawyerStats } from '@/lib/queries/partner';

const positionColors: Record<string, string> = {
  'Founding Partner':    'text-gold-700 dark:text-gold-300',
  'Managing Partner':    'text-gold-700 dark:text-gold-300',
  'Monitoring Partner':  'text-blue-700 dark:text-blue-300',
  'Partner':             'text-orange-600 dark:text-orange-400',
  'Of Counsel':          'text-yellow-600 dark:text-yellow-400',
  'Senior Associate':    'text-purple-600 dark:text-purple-400',
  'Mid-level Associate': 'text-pink-600 dark:text-pink-400',
  'Junior Associate':    'text-red-600 dark:text-red-400',
  'Underbar Associate':  'text-gray-500 dark:text-stone-400',
};

// Classify matter names into types by keyword matching
function classifyMatters(raw: string): { total: number; types: { label: string; count: number }[] } {
  if (!raw || raw === '0') return { total: 0, types: [] };

  const text = ` ${raw} `;

  const patterns: [string, RegExp][] = [
    ['Retainer',    /Retainer/gi],
    ['Criminal',    /People v\./gi],
    ['IP/TM',       /\bIP\b|\bTM\b|Trademark|Patent/gi],
    ['Corporate',   /Incorporation|SEC Complaint|SEC\b/gi],
    ['Collection',  /Collection/gi],
  ];

  const counts: Record<string, number> = {};

  for (const [label, regex] of patterns) {
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      counts[label] = matches.length;
    }
  }

  const vCount = (text.match(/ v\. /g) || []).length;
  const retainerCount = (text.match(/Retainer/gi) || []).length;
  const incorpCount = (text.match(/Incorporation/gi) || []).length;
  const collectionCount = (text.match(/Collection/gi) || []).length;
  const secCount = (text.match(/SEC Complaint|SEC\b/gi) || []).length;
  const total = Math.max(vCount + retainerCount + incorpCount + collectionCount + secCount, 1);

  const criminalCount = counts['Criminal'] || 0;
  const civilCount = vCount - criminalCount;
  if (civilCount > 0) counts['Civil'] = civilCount;
  delete counts['Criminal'];
  if (criminalCount > 0) counts['Criminal'] = criminalCount;

  const types = Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  return { total, types };
}

const typeColors: Record<string, string> = {
  'Retainer':   'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  'Civil':      'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300',
  'Criminal':   'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
  'IP/TM':      'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300',
  'Corporate':  'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300',
  'Collection': 'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-300',
};

interface Props {
  lawyers: LawyerStats[];
}

export default function TeamPerformanceCard({ lawyers }: Props) {
  const sorted = [...lawyers].sort((a, b) => b.activeMatterCount - a.activeMatterCount);

  return (
    <SectionCard id="team-performance" title="Team Performance" icon={<Users className="w-5 h-5" />} count={lawyers.length}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-stone-100 dark:border-stone-800">
              <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Lawyer</th>
              <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 text-right dark:text-stone-500">Matters</th>
              <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 text-right dark:text-stone-500">Pending</th>
              <th className="pb-2.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Ongoing Breakdown</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => {
              const { types } = classifyMatters(l.ongoingMatters);
              return (
                <tr key={l.id} className="border-b border-stone-100/50 dark:border-stone-800/50">
                  <td className="py-2.5">
                    <span className="font-semibold text-stone-900 dark:text-stone-100">{l.initials}</span>
                    <span className={`ml-2 text-xs ${positionColors[l.position] ?? 'text-stone-400 dark:text-stone-500'}`}>
                      {l.position}
                    </span>
                  </td>
                  <td className="py-2.5 text-right font-semibold text-stone-900 tabular-nums dark:text-stone-100">{l.activeMatterCount}</td>
                  <td className="py-2.5 text-right text-stone-700 tabular-nums dark:text-stone-200">{l.pendingDeliverables}</td>
                  <td className="py-2.5">
                    {types.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {types.map((t) => (
                          <span
                            key={t.label}
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${typeColors[t.label] ?? 'bg-gray-50 text-gray-600 dark:bg-stone-800 dark:text-stone-300'}`}
                          >
                            {t.count} {t.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-stone-400 dark:text-stone-500">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
