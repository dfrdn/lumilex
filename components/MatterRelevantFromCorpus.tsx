import { getSupabase } from '@/lib/supabase';
import MatterRelevantFromCorpusClient from './MatterRelevantFromCorpusClient';

interface Props {
  matterId: string;
  matterName: string;
}

/**
 * "Relevant from corpus" panel on the matter detail page.
 * Server component: resolves the query string from matter_summaries (with
 * fallbacks) so the client can fire a single SWR request without an extra
 * round-trip. Hidden entirely when there's no usable query — avoids noise
 * on brand-new matters that have no summary yet.
 */
export default async function MatterRelevantFromCorpus({ matterId, matterName }: Props) {
  const query = await resolveQueryForMatter(matterId, matterName);
  if (!query) return null;

  return <MatterRelevantFromCorpusClient matterId={matterId} query={query} />;
}

async function resolveQueryForMatter(matterId: string, matterName: string): Promise<string | null> {
  const supabase = getSupabase();

  // Prefer the AI-generated matter summary — it's the densest semantic
  // signal of "what this matter is about."
  const { data: summary } = await supabase
    .from('matter_summaries')
    .select('summary, latest_incident')
    .eq('matter_id', matterId)
    .single();
  if (summary?.summary && summary.summary.trim().length >= 40) {
    return summary.summary.trim().slice(0, 800);
  }

  // Fall back to case_title + case_description on the matter row.
  const { data: matter } = await supabase
    .from('matters')
    .select('case_title, case_description')
    .eq('notion_id', matterId)
    .single();

  const parts = [matter?.case_title, matter?.case_description].filter(
    (s): s is string => !!s && s.trim().length > 0,
  );
  if (parts.length > 0) return parts.join('. ').slice(0, 800);

  // Last fallback: the matter name itself. Only useful if it's descriptive.
  if (matterName && matterName.trim().length >= 8) return matterName.trim();

  return null;
}
