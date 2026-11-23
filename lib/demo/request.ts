import { cache } from 'react';
import { headers } from 'next/headers';
import { findFirmIdByHost, getFirmConfig } from '@/lib/firm/config';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isDemoDeployment } from '@/lib/demo/guard';
import { DEMO_PERSONA_KEYS, type DemoPersonaKey } from '@/lib/demo/personas';

export interface DemoPersonaCard {
  key: DemoPersonaKey;
  name: string;
  position: string;
}

/**
 * The demo picker's data for this request, or null when the request is not on
 * the demo — the deployment has to declare itself one and the host's firm has
 * to be the demo firm, the same two conditions the sign-in route checks before
 * it looks at a persona. A persona whose staff row is gone or inactive is left
 * off rather than offered and refused.
 */
export const resolveRequestDemo = cache(
  async (): Promise<{ firmId: string; personas: DemoPersonaCard[] } | null> => {
    if (!isDemoDeployment()) return null;
    const host = (await headers()).get('host');
    const firmId = host ? await findFirmIdByHost(host) : null;
    if (!firmId) return null;

    const firm = await getFirmConfig(firmId);
    if (!firm.demo.enabled) return null;

    const { data } = await getServiceDbForFirm(firmId)
      .from('team')
      .select('person_id, name, position')
      .in('person_id', firm.demo.personas.map((p) => p.personId))
      .eq('active', true);
    const members = new Map((data ?? []).map((m) => [m.person_id as string, m]));

    const personas = DEMO_PERSONA_KEYS.flatMap((key) => {
      const persona = firm.demo.personas.find((p) => p.key === key);
      const member = persona ? members.get(persona.personId) : undefined;
      return member
        ? [{ key, name: member.name as string, position: (member.position as string | null) ?? '' }]
        : [];
    });

    return { firmId, personas };
  },
);
