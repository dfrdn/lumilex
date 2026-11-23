import { readSavedSidebar, type SavedSidebar } from '@/lib/nav/custom-sidebar';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/** The person's saved sidebar, for the area layouts. A failed read leaves them on the role's default. */
export async function getSavedSidebar(firmId: string, email: string | null | undefined): Promise<SavedSidebar> {
  if (!email) return {};
  // RLS (user_preferences_own) admits only the signed-in person's own row.
  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('sidebar_layout')
    .eq('firm_id', firmId)
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();
  if (error) {
    console.error('[sidebar] Failed to read saved sidebar:', error);
    return {};
  }
  return readSavedSidebar(data?.sidebar_layout);
}
