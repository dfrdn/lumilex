'use client';

import { useState } from 'react';
import ClientRelationshipPartnerPicker from '../ClientRelationshipPartnerPicker';
import type { DropdownOption } from '@/components/admin/CellDropdown';

/** Stateful wrapper around the controlled picker for the standalone detail page. */
export default function RelationshipPartnerField({
  clientId,
  initialRelationshipPartnerId,
  options,
  nameById,
}: {
  clientId: string;
  initialRelationshipPartnerId: string | null;
  options: DropdownOption[];
  nameById: Record<string, string>;
}) {
  const [value, setValue] = useState(initialRelationshipPartnerId);
  return <ClientRelationshipPartnerPicker clientId={clientId} value={value} options={options} nameById={nameById} onChange={setValue} withLabel />;
}
