-- Each matter's latest deliverable sent out, for My Matters' last-incident
-- column. date_done is when it went; older filings predate that column, so
-- their due date stands in. One row per matter, so a long filed history stays
-- in the database.
--
-- Ported from the origin app #361 in the shape of search_document_text
-- (20260928_document_keyword_search.sql): .rpc() passes through
-- getServiceDbForFirm untouched, so p_firm_id comes first, has no default,
-- and is the filter that keeps one firm's filings out of another's list. It
-- is SECURITY INVOKER, and no API role may execute it — the app calls it on
-- the firm-scoped service client.

CREATE OR REPLACE FUNCTION public.last_filings(p_firm_id uuid, p_matter_ids text[])
RETURNS TABLE (matter_id text, notion_id text, name text, filed_on date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (d.matter_id)
    d.matter_id, d.notion_id, d.name, coalesce(d.date_done, d.external_due_date)
  FROM public.deliverables d
  WHERE d.firm_id = p_firm_id
    AND d.matter_id = ANY (p_matter_ids)
    AND d.status = 'Filed or Sent out'
    AND coalesce(d.date_done, d.external_due_date) IS NOT NULL
  ORDER BY d.matter_id, coalesce(d.date_done, d.external_due_date) DESC, d.notion_id
$$;

REVOKE EXECUTE ON FUNCTION public.last_filings(uuid, text[]) FROM PUBLIC, anon, authenticated;
