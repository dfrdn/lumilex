'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { BTN_PRIMARY } from '@/components/ui/tone';
import { NewCaseModal } from './forms';

/** Opens a case in evaluation, then goes to it. */
export default function NewCaseButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${BTN_PRIMARY} px-3 py-1.5`}>
        <Plus className="w-3.5 h-3.5" /> New case
      </button>
      <NewCaseModal open={open} onClose={() => setOpen(false)} onCreated={(id) => router.push(`/dashboard/cases/${id}`)} />
    </>
  );
}
