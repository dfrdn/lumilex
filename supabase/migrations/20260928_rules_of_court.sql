-- Rules of Court in the Library.
--
-- The text of the 2019 Rules of Civil Procedure, the Revised Rules of Criminal
-- Procedure, and the 2019 Rules on Evidence, one row per section, imported
-- from the Supreme Court's publications (scripts/import-rules-of-court.ts).
-- Each rule is also a Library page (kb_pages.kind = 'rules_of_court') so the
-- rules read and search like the rest of the Library; the section rows are
-- what keyword search and the deadline rule sets cite precisely.
--
-- The text is public, but the table is a tenant table: every section points at
-- its rule's page in one firm's Library, and kb_pages is per firm. The importer
-- takes a firm, like the seed scripts. Staff read their own firm's sections;
-- writes are the importer's, through the service role.
--
-- search_court_rules takes p_firm_id first with no default, like
-- search_document_text, and EXECUTE is revoked from the API roles.

alter table public.kb_pages drop constraint if exists kb_pages_kind_check;
alter table public.kb_pages add constraint kb_pages_kind_check check (kind = any (array[
  'doctrine', 'template_clause', 'judge', 'court', 'opposing_counsel', 'opposing_party', 'playbook', 'general', 'evidence_rule',
  'guide', 'policy', 'reference', 'announcement',
  'rules_of_court'
]));

create table if not exists public.court_rule_sections (
  id          bigint generated always as identity primary key,
  firm_id     uuid not null references public.firms(id),
  source      text not null check (source in ('civil', 'criminal', 'evidence')),
  part        text,
  rule        integer not null,
  rule_title  text not null,
  heading     text,
  section     integer not null,
  title       text not null,
  text        text not null,
  -- "Rule 132, Section 34"
  citation    text not null,
  kb_page_id  bigint references public.kb_pages(id) on delete set null,
  text_tsv    tsvector generated always as (
                to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(text, ''))
              ) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (firm_id, source, rule, section)
);

create index if not exists court_rule_sections_tsv_idx on public.court_rule_sections using gin (text_tsv);
create index if not exists court_rule_sections_page_idx on public.court_rule_sections (kb_page_id);

alter table public.court_rule_sections enable row level security;

drop policy if exists court_rule_sections_staff_select on public.court_rule_sections;
create policy court_rule_sections_staff_select on public.court_rule_sections
  for select to authenticated
  using (firm_id = public.current_firm_id() and public.current_person_id() is not null);

-- Keyword search over the sections, for the Exact matches group in Search.
drop function if exists public.search_court_rules(uuid, text, integer);

create function public.search_court_rules(
  p_firm_id uuid,
  p_query   text,
  p_limit   integer default 10
)
returns table (
  id          bigint,
  source      text,
  rule        integer,
  section     integer,
  citation    text,
  title       text,
  kb_page_id  bigint,
  rank        real,
  headline    text
)
language sql
stable
set search_path = public, pg_temp
as $function$
  with q as (
    select websearch_to_tsquery('english', p_query) as tsq
  ),
  hits as (
    select s.id, s.source, s.rule, s.section, s.citation, s.title, s.kb_page_id, s.text,
           ts_rank_cd(s.text_tsv, q.tsq) as rank
    from public.court_rule_sections s, q
    where s.firm_id = p_firm_id
      and s.text_tsv @@ q.tsq
    order by rank desc, s.id
    limit greatest(1, least(p_limit, 50))
  )
  select h.id, h.source, h.rule, h.section, h.citation, h.title, h.kb_page_id, h.rank,
         ts_headline('english', h.text, q.tsq, 'MaxWords=40, MinWords=20, StartSel=«, StopSel=», MaxFragments=1') as headline
  from hits h, q;
$function$;

revoke execute on function public.search_court_rules(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_court_rules(uuid, text, integer) to service_role;
