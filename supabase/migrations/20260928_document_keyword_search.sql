-- Keyword search over document text, alongside the semantic index.
--
-- Semantic search is weakest at exactly what lawyers type: a party name, a
-- docket number, a quoted clause. This adds a full-text index over the text
-- the file analysis stores and an RPC that returns ranked hits with a
-- headline, which lib/ai/knowledge-search.ts merges in front of the semantic
-- results as "Exact matches".
--
-- extracted_text_source records where the text came from ('parser' for
-- pdf-parse/mammoth, 'transcription' for Claude reading a scanned PDF), so
-- partial or machine-read text is distinguishable later.
--
-- search_document_text takes p_firm_id first, required, no default — the same
-- shape as 20260824_firm_scope_blind_rpcs.sql. It is SECURITY INVOKER and
-- called on the service-role client, which bypasses RLS, and `.rpc()` passes
-- straight through getServiceDbForFirm, so the firm filter inside the function
-- is the only thing pinning it to one firm. EXECUTE is revoked from the API
-- roles: file_analyses has no policies, so an authed caller would read nothing
-- anyway, and the function has no business being reachable over PostgREST.

alter table public.file_analyses
  add column if not exists extracted_text_source text;

comment on column public.file_analyses.extracted_text_source is
  'How extracted_text was obtained: parser | transcription. NULL for rows written before this column existed.';

alter table public.file_analyses
  add column if not exists text_tsv tsvector
  generated always as (
    to_tsvector('english'::regconfig, left(coalesce(extracted_text, ''), 300000))
  ) stored;

create index if not exists file_analyses_text_tsv_idx
  on public.file_analyses using gin (text_tsv);

-- websearch_to_tsquery accepts what people naturally type: bare words (AND),
-- "quoted phrases", OR, -exclusions. The caller narrows the hits to what the
-- viewer may open before they are returned.
drop function if exists public.search_document_text(uuid, text, integer);

create function public.search_document_text(
  p_firm_id uuid,
  p_query   text,
  p_limit   integer default 20
)
returns table (
  analysis_id         bigint,
  file_id             text,
  deliverable_file_id bigint,
  attachment_name     text,
  rank                real,
  headline            text
)
language sql
stable
set search_path = public, pg_temp
as $function$
  with q as (
    select websearch_to_tsquery('english', p_query) as tsq
  ),
  hits as (
    select
      fa.id,
      fa.file_id,
      fa.deliverable_file_id,
      fa.attachment_name,
      fa.extracted_text,
      ts_rank_cd(fa.text_tsv, q.tsq) as rank
    from public.file_analyses fa, q
    where fa.firm_id = p_firm_id
      and fa.status = 'completed'
      and (fa.file_id is not null or fa.deliverable_file_id is not null)
      and fa.text_tsv @@ q.tsq
    order by rank desc, fa.id desc
    limit greatest(1, least(p_limit, 100))
  )
  select
    h.id,
    h.file_id,
    h.deliverable_file_id,
    h.attachment_name,
    h.rank,
    ts_headline(
      'english',
      h.extracted_text,
      q.tsq,
      'MaxWords=45, MinWords=25, MaxFragments=1, StartSel=«, StopSel=»'
    ) as headline
  from hits h, q
  order by h.rank desc, h.id desc;
$function$;

revoke execute on function public.search_document_text(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_document_text(uuid, text, integer) to service_role;
