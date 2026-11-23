'use client';

import type { Corporation } from '@/types/corporations';
import type { CorporationTeamMember } from '@/lib/queries/corporations';
import SubjectHeader from '@/components/ui/SubjectHeader';
import { CopyText, MetaChip } from '@/components/ui/primitives';

/**
 * Who the company is, at a glance: name, lifecycle status, the identifiers the
 * firm quotes most (click to copy), the client it is done for, and the lawyers
 * on its matters.
 */
export default function CorporationHeader({
  corporation,
  displayName,
  statusPill,
  clientName,
  team,
  actions,
}: {
  corporation: Corporation;
  displayName: string;
  statusPill: React.ReactNode;
  clientName: string | null;
  team: CorporationTeamMember[];
  actions?: React.ReactNode;
}) {
  const clientId = corporation.engagingClientId ?? corporation.clientId;
  return (
    <SubjectHeader
      title={displayName}
      monogramOf={displayName}
      statusPill={statusPill}
      meta={
        <>
          {corporation.companyType && <MetaChip>{corporation.companyType}</MetaChip>}
          {corporation.secRegistrationNo && (
            <MetaChip mono>
              SEC <CopyText text={corporation.secRegistrationNo} className="ml-1" />
            </MetaChip>
          )}
          {corporation.birTin && (
            <MetaChip mono>
              TIN <CopyText text={corporation.birTin} className="ml-1" />
            </MetaChip>
          )}
        </>
      }
      client={clientId && clientName ? { id: clientId, name: clientName } : null}
      team={team}
      actions={actions}
    />
  );
}
