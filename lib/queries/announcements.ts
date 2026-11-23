import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import type { NotionAnnouncement } from '@/types/notion';

function mapRow(row: any): NotionAnnouncement {
  return {
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    createdTime: row.created_time,
    content: row.content,
  };
}

export async function getAnnouncements(firmId: string): Promise<NotionAnnouncement[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_time', { ascending: false })
    .limit(10);

  if (error) throw error;
  return (data ?? []).map(mapRow);
}
