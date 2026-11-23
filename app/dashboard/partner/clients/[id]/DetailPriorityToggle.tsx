'use client';

import { useState } from 'react';
import ClientPriorityToggle from '../ClientPriorityToggle';

/** Stateful wrapper around the controlled toggle for the standalone detail page. */
export default function DetailPriorityToggle({ clientId, initialPriority }: { clientId: string; initialPriority: boolean }) {
  const [priority, setPriority] = useState(initialPriority);
  return <ClientPriorityToggle clientId={clientId} priority={priority} onChange={setPriority} withLabel />;
}
