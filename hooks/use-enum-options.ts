'use client';

import useSWR from 'swr';
import { useMemo } from 'react';
import type { EnumOption } from '@/lib/enum-options';
import { getDefaultValues } from '@/lib/enum-defaults';

interface EnumOptionsResponse {
  options: EnumOption[];
}

/**
 * Every active option, all groups. One small response (about a hundred rows)
 * shared by every dropdown, so a page mounts one request rather than one per
 * (entity, field). The admin editor revalidates this key after each edit.
 */
export const ACTIVE_ENUM_OPTIONS_KEY = '/api/enum-options';

/**
 * Active (entity, field) option values. Returns the bootstrap defaults
 * while loading or if the DB has no rows yet, so dropdowns are never
 * empty.
 *
 * Options change rarely, and the quick-create and quick-action modals keep
 * these hooks mounted on every page, so they skip focus revalidation and
 * refetch at most every five minutes. An admin's edit reaches other open
 * tabs within that window.
 */
export function useEnumValues(entity: string, field: string): string[] {
  const { data } = useSWR<EnumOptionsResponse>(ACTIVE_ENUM_OPTIONS_KEY, {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const active = (data?.options ?? [])
      .filter((o) => o.entity === entity && o.field === field && o.is_active)
      .map((o) => o.value);
    return active.length ? active : getDefaultValues(entity, field);
  }, [data, entity, field]);
}

/**
 * Raw rows for the editor UI — includes inactive entries, ids, and
 * metadata. Don't use this in feature dropdowns.
 */
export function useEnumOptionsRaw(entity: string, field: string) {
  return useSWR<EnumOptionsResponse>(
    `/api/enum-options?entity=${encodeURIComponent(entity)}&field=${encodeURIComponent(field)}&all=1`,
  );
}
