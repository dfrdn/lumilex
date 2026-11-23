import { ReactNode } from 'react';

interface Props {
  label: string;
  children: ReactNode;
}

export default function DetailField({ label, children }: Props) {
  return (
    <div className="py-3 border-b border-stone-100 dark:border-white/[0.06] last:border-0">
      <dt className="text-[12px] text-stone-500 dark:text-stone-400 mb-1">{label}</dt>
      <dd className="text-[13px] text-stone-800 dark:text-stone-100 leading-relaxed">{children}</dd>
    </div>
  );
}
