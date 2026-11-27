-- Legal codes in the Library.
--
-- The codes a firm works from (the Labor Code and the Revised Corporation
-- Code; later the Civil Code, Revised Penal Code, Family Code, IP Code and
-- SRC), one row per article or section, imported by
-- scripts/import-legal-codes.ts. Each code is one Library page
-- (kb_pages.kind = 'legal_code') that reads as a whole; the provision rows are
-- what the page renders, what search retrieves, and what a quotation is
-- checked against.
--
-- Every provision keeps its history in code_provision_versions: the original
-- text, then each amendment, insertion, renumbering or repeal with the law and
-- section that made it. An earlier version's text may be unknown (a source
-- that only footnotes the amending law); text is null then.
--
-- A provision is checked by a reviewer against its source before research
-- leans on it. code_provision_reviews is that record, append-only.
--
-- The text is public, but all four tables are tenant tables, like
-- court_rule_sections: each code points at its page in one firm's Library, and
-- a review is one firm's sign-off. The children carry firm_id and reach their
-- parent through a composite (firm_id, ...) foreign key, so a row can never
-- hang off another firm's code or provision. Staff read their own firm's rows;
-- writes are the importer's through the service role, except a review, which a
-- reviewer records as themself.
--
-- search_code_provisions takes p_firm_id first with no default, like
-- search_court_rules, and EXECUTE is revoked from the API roles.

alter table public.kb_pages drop constraint if exists kb_pages_kind_check;
alter table public.kb_pages add constraint kb_pages_kind_check check (kind = any (array[
  'doctrine', 'template_clause', 'judge', 'court', 'opposing_counsel', 'opposing_party', 'playbook', 'general', 'evidence_rule',
  'guide', 'policy', 'reference', 'announcement',
  'rules_of_court', 'legal_code'
]));

create table if not exists public.legal_codes (
  firm_id       uuid not null references public.firms(id),
  -- "labor", "rcc": the key in lib/codes/model.ts, the same in every firm.
  id            text not null,
  -- "Labor Code of the Philippines"
  title         text not null,
  -- The citation's short title: "Labor Code", never abbreviated.
  short_title   text not null,
  -- "Presidential Decree No. 442"
  instrument    text not null,
  enacted_on    date,
  effective_on  date,
  unit          text not null check (unit in ('article', 'section')),
  -- What the text is: "DOLE Edition 2022, as amended and renumbered".
  edition       text,
  source_label  text,
  source_url    text,
  kb_page_id    bigint references public.kb_pages(id) on delete set null,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (firm_id, id)
);

create table if not exists public.code_provisions (
  id             bigint generated always as identity primary key,
  firm_id        uuid not null,
  code_id        text not null,
  -- "237", "266-A"
  number         text not null,
  -- The number before a renumbering: the Labor Code's "[231]".
  former_number  text,
  -- Reading order within the code.
  position       integer not null,
  -- Divisions above the provision, outermost first.
  path           text[] not null default '{}',
  heading        text,
  -- The text in force; empty for a repealed provision.
  text           text not null,
  status         text not null default 'in_force' check (status in ('in_force', 'repealed')),
  -- "Labor Code, art. 237"
  citation       text not null,
  text_tsv       tsvector generated always as (
                   to_tsvector('english'::regconfig, coalesce(heading, '') || ' ' || coalesce(text, ''))
                 ) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (firm_id, code_id, number),
  unique (firm_id, id),
  foreign key (firm_id, code_id) references public.legal_codes (firm_id, id) on delete cascade
);

create index if not exists code_provisions_tsv_idx on public.code_provisions using gin (text_tsv);
create index if not exists code_provisions_order_idx on public.code_provisions (firm_id, code_id, position);

create table if not exists public.code_provision_versions (
  id                  bigint generated always as identity primary key,
  firm_id             uuid not null,
  provision_id        bigint not null,
  -- 0 is the provision as first enacted; each change adds one.
  seq                 integer not null,
  change              text not null check (change in ('original', 'amended', 'inserted', 'repealed', 'renumbered')),
  -- The provision as it read after this change; null when the source does not give it.
  number              text,
  heading             text,
  text                text,
  effective_on        date,
  -- The law that made the change ("Republic Act No. 6715") and where in it ("sec. 3"). Null on the original.
  instrument          text,
  instrument_section  text,
  approved_on         date,
  instrument_url      text,
  -- The source's own note on the change, e.g. a DOLE edition footnote.
  note                text,
  created_at          timestamptz not null default now(),
  unique (provision_id, seq),
  foreign key (firm_id, provision_id) references public.code_provisions (firm_id, id) on delete cascade
);

create index if not exists code_provision_versions_firm_idx on public.code_provision_versions (firm_id, provision_id);

create table if not exists public.code_provision_reviews (
  id            bigint generated always as identity primary key,
  firm_id       uuid not null,
  provision_id  bigint not null,
  -- The version the reviewer checked; a later re-import that changes the text leaves the review on the old version.
  version_seq   integer not null,
  reviewed_by   text not null,
  reviewed_at   timestamptz not null default now(),
  note          text,
  foreign key (firm_id, provision_id) references public.code_provisions (firm_id, id) on delete cascade
);

create index if not exists code_provision_reviews_provision_idx on public.code_provision_reviews (firm_id, provision_id, reviewed_at desc);

alter table public.legal_codes enable row level security;
alter table public.code_provisions enable row level security;
alter table public.code_provision_versions enable row level security;
alter table public.code_provision_reviews enable row level security;

drop policy if exists legal_codes_staff_select on public.legal_codes;
create policy legal_codes_staff_select on public.legal_codes
  for select to authenticated
  using (firm_id = public.current_firm_id() and public.current_person_id() is not null);

drop policy if exists code_provisions_staff_select on public.code_provisions;
create policy code_provisions_staff_select on public.code_provisions
  for select to authenticated
  using (firm_id = public.current_firm_id() and public.current_person_id() is not null);

drop policy if exists code_provision_versions_staff_select on public.code_provision_versions;
create policy code_provision_versions_staff_select on public.code_provision_versions
  for select to authenticated
  using (firm_id = public.current_firm_id() and public.current_person_id() is not null);

drop policy if exists code_provision_reviews_staff_select on public.code_provision_reviews;
create policy code_provision_reviews_staff_select on public.code_provision_reviews
  for select to authenticated
  using (firm_id = public.current_firm_id() and public.current_person_id() is not null);

-- A reviewer records their own review, in their own firm; nobody edits or deletes one.
drop policy if exists code_provision_reviews_reviewer_insert on public.code_provision_reviews;
create policy code_provision_reviews_reviewer_insert on public.code_provision_reviews
  for insert to authenticated
  with check (
    firm_id = public.current_firm_id()
    and reviewed_by = public.current_person_id()
    and public."current_role"() = any (array['partner', 'admin', 'super_user'])
  );

-- Keyword search over the provisions, for the Exact matches group in Search.
drop function if exists public.search_code_provisions(uuid, text, integer, text[]);

create function public.search_code_provisions(
  p_firm_id uuid,
  p_query   text,
  p_limit   integer default 10,
  p_codes   text[] default null
)
returns table (
  id        bigint,
  code_id   text,
  number    text,
  citation  text,
  heading   text,
  status    text,
  rank      real,
  headline  text
)
language sql
stable
set search_path = public, pg_temp
as $function$
  with q as (
    select websearch_to_tsquery('english', p_query) as tsq
  ),
  hits as (
    select p.id, p.code_id, p.number, p.citation, p.heading, p.status, p.text,
           ts_rank_cd(p.text_tsv, q.tsq) as rank
    from public.code_provisions p, q
    where p.firm_id = p_firm_id
      and p.text_tsv @@ q.tsq
      and (p_codes is null or p.code_id = any (p_codes))
    order by rank desc, p.id
    limit greatest(1, least(p_limit, 50))
  )
  select h.id, h.code_id, h.number, h.citation, h.heading, h.status, h.rank,
         ts_headline('english', h.text, q.tsq, 'MaxWords=40, MinWords=20, StartSel=«, StopSel=», MaxFragments=1') as headline
  from hits h, q;
$function$;

revoke execute on function public.search_code_provisions(uuid, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.search_code_provisions(uuid, text, integer, text[]) to service_role;
