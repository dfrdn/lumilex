import { AlertTriangle } from 'lucide-react';

/** A section whose data failed to load — never shown as an empty list, which would read as "nothing today". */
export default function LoadError({ message = "Couldn't load this — refresh to try again." }: { message?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-6 text-center animate-fade-in">
      <AlertTriangle className="w-7 h-7 mb-2 text-amber-500 dark:text-amber-400" />
      <p className="text-sm text-amber-700 dark:text-amber-300">{message}</p>
    </div>
  );
}
