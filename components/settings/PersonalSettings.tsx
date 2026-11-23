import type { Session } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isFeatureAvailable } from '@/lib/firm/features';
import SettingsPageClient from '@/components/settings/SettingsPageClient';
import { parseSettingsTab } from '@/lib/settings/tabs';

/** A person's own Settings, for whichever shell they open it in: `basePath` is that shell's Settings URL. */
export default async function PersonalSettings({
  session, basePath, tab,
}: { session: Session; basePath: string; tab: string | string[] | undefined }) {
  const userName = session.user.name ?? '';
  const role = session.user.role ?? 'lawyer';
  const userImage = session.user.image ?? null;

  const [{ data: member }, push] = await Promise.all([
    getServiceDbForFirm(session.firmId)
      .from('team')
      .select('name, email, position, role, start_date, initials, nickname, avatar_url, headshot_url')
      .eq('person_id', session.user.notionUserId)
      .eq('active', true)
      .single(),
    isFeatureAvailable(session.firmId, 'push'),
  ]);

  const profile = {
    name: member?.name ?? userName,
    email: member?.email ?? session.user.email ?? '',
    position: member?.position ?? '',
    role: member?.role ?? role,
    startDate: member?.start_date ?? null,
    initials: member?.initials ?? userName.charAt(0).toUpperCase(),
    nickname: member?.nickname ?? '',
    avatar: member?.avatar_url || userImage,
    headshot: member?.headshot_url || null,
  };

  return <SettingsPageClient profile={profile} features={{ push }} tab={parseSettingsTab(tab)} basePath={basePath} />;
}
