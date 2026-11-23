import { getSession } from '@/lib/session';
import { redirect, notFound } from 'next/navigation';
import AdminEntityPage from '@/components/admin/AdminEntityPage';
import { ENTITY_CONFIGS, type EntityConfig } from '@/lib/admin/entity-config';
import { fetchAllEnumOptions } from '@/lib/enum-options';
import { getLiaisonOfficers } from '@/lib/queries/liaison';

export const revalidate = 30;

export async function generateMetadata({ params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  return { title: ENTITY_CONFIGS[entity]?.labelPlural ?? 'Admin' };
}

interface Props {
  params: Promise<{ entity: string }>;
}

export default async function AdminEntityRoute({ params }: Props) {
  const { entity } = await params;

  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const entityConfig = ENTITY_CONFIGS[entity];
  if (!entityConfig) {
    notFound();
  }

  const [enumOverrides, liaisonNames] = await Promise.all([
    fetchAllEnumOptions(session.firmId),
    entity === 'liaison_tasks'
      ? getLiaisonOfficers(session.firmId).then((officers) => officers.map((o) => o.name))
      : Promise.resolve([] as string[]),
  ]);
  const sourceEntity = entityConfig.viewOf ?? entity;
  const mergedConfig: EntityConfig = {
    ...entityConfig,
    fields: entityConfig.fields.map((f) => {
      if (entity === 'liaison_tasks' && f.supabaseColumn === 'assigned_to_name') {
        return { ...f, options: liaisonNames };
      }
      const override = enumOverrides[sourceEntity]?.[f.supabaseColumn];
      return override ? { ...f, options: override } : f;
    }),
  };

  return (
    <AdminEntityPage entity={entity} entityConfig={mergedConfig} />
  );
}
