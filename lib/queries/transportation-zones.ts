import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export interface TransportationZone {
  id: number;
  name: string;
  round_trip_rate: number;
  notes: string;
  active: boolean;
  updated_by: string | null;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
}

export async function getAllZones(firmId: string, includeInactive = false): Promise<TransportationZone[]> {
  const supabase = getServiceDbForFirm(firmId);
  let q = supabase.from('transportation_zones').select('*').order('name');
  if (!includeInactive) q = q.eq('active', true);
  const { data } = await q;
  return (data ?? []) as TransportationZone[];
}
