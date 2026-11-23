'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import CellDropdown from '@/components/admin/CellDropdown';
import { confirmAction } from '@/components/ui/confirm';

/**
 * The mark's client — its own field now that several matters can cover one
 * mark. Changing it moves the mark into that client's numbering (the Ref.
 * No.'s client code and index follow, in the database).
 */
export default function MarkClientPicker({
  clientId,
  clientName,
  onChange,
}: {
  clientId: string | null;
  clientName: string;
  onChange: (clientId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || clients) return;
    fetch('/api/clients-matters')
      .then((r) => r.json())
      .then((d: { clients?: { id: string; name: string }[] }) => setClients(d.clients ?? []))
      .catch(() => toast.error('Could not load clients.'));
  }, [open, clients]);

  return (
    <span className="flex items-center justify-between gap-2 min-w-0">
      {clientId && clientName ? (
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-navy-700 dark:text-navy-300 hover:underline underline-offset-2 truncate">
          {clientName}
        </Link>
      ) : (
        <span className="text-sm text-stone-400 dark:text-stone-500">—</span>
      )}
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="press shrink-0 p-1 text-stone-400 dark:text-stone-500 hover:text-navy-700 dark:hover:text-navy-300"
        title="Change the client"
      >
        <Pencil className="w-3 h-3" />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={clientId}
          placeholder={clients ? 'Search clients…' : 'Loading clients…'}
          options={(clients ?? []).map((c) => ({ id: c.id, label: c.name }))}
          anchorRef={anchor}
          onClose={() => setOpen(false)}
          onSelect={async (next) => {
            setOpen(false);
            if (!next || next === clientId) return;
            const ok = await confirmAction({
              title: 'Move this mark to that client?',
              message: 'Its Ref. No. changes to the new client’s code and next number.',
              confirmLabel: 'Move mark',
            });
            if (ok) void onChange(next);
          }}
        />
      )}
    </span>
  );
}
