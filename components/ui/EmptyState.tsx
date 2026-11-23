import { Inbox } from 'lucide-react';

export default function EmptyState({
  message = 'Nothing here',
  icon,
  action,
}: {
  message?: string;
  icon?: React.ReactNode;
  /** The way out, such as a link to a wider list. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center animate-fade-in">
      <span className="text-[var(--text-muted)] mb-2 opacity-50">
        {icon ?? <Inbox className="w-8 h-8" />}
      </span>
      <p className="text-sm text-[var(--text-muted)]">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
