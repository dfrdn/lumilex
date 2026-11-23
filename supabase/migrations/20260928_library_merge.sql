-- The Library becomes one table.
--
-- The firm handbook (resources: guides, policies, references, announcements,
-- written in the rich-text editor) and the AI-distilled pages (kb_pages:
-- doctrine, template clauses, court profiles, mined from closed matters with
-- citations) were two tables behind two screens with two permission models.
-- They are one Library with one review workflow now. kb_pages is the surviving
-- table; the handbook rows move in with their format recorded, so each page
-- renders the way it was written.
--
-- Also fixed here: kb_pages.slug was unique across every firm. The backfill
-- reads a slug through the firm-scoped client and inserts when it finds none,
-- so a second firm distilling a page another firm already holds hit the global
-- unique — a failed insert, and an answer to "does another firm have a page
-- called X?". The key is (firm_id, slug), as it already was on resources.
--
-- resources is renamed, not dropped: resources_legacy_20260928 keeps the rows
-- until the merged Library has been in use for a while, and loses its API
-- grants so nothing reads it by accident. The copy is checked row for row
-- before the rename. Idempotent: once resources is gone the block is a no-op.

-- ── Per-firm slugs ──
alter table public.kb_pages drop constraint if exists kb_pages_slug_key;
create unique index if not exists kb_pages_firm_slug_key
  on public.kb_pages (firm_id, slug);

-- ── The handbook's columns ──
alter table public.kb_pages add column if not exists content_format text not null default 'md';
alter table public.kb_pages drop constraint if exists kb_pages_content_format_check;
alter table public.kb_pages add constraint kb_pages_content_format_check
  check (content_format in ('md', 'html'));

alter table public.kb_pages add column if not exists author_name text;
alter table public.kb_pages add column if not exists visible_to_roles text[];
alter table public.kb_pages add column if not exists external_url text;
alter table public.kb_pages add column if not exists cover_image_path text;
alter table public.kb_pages add column if not exists legacy_resource_id integer;
create unique index if not exists kb_pages_legacy_resource_id_idx
  on public.kb_pages (legacy_resource_id) where legacy_resource_id is not null;

comment on column public.kb_pages.content_format is
  'md for pages written or generated as Markdown; html for handbook pages written in the rich-text editor.';
comment on column public.kb_pages.visible_to_roles is
  'Roles that may read the page; NULL or empty means every staff role. Admins and super_users read every page.';
comment on column public.kb_pages.legacy_resource_id is
  'The resources.id this page was carried over from in the 2026-09 Library merge; NULL for every page created since.';

alter table public.kb_pages drop constraint if exists kb_pages_kind_check;
alter table public.kb_pages add constraint kb_pages_kind_check check (kind = any (array[
  'doctrine', 'template_clause', 'judge', 'court', 'opposing_counsel', 'opposing_party', 'playbook', 'general', 'evidence_rule',
  'guide', 'policy', 'reference', 'announcement'
]));

-- ── Carry the handbook over ──
-- A 'general' handbook category becomes 'reference' so it does not collide
-- with the AI 'general' kind, which lawyers may not edit. A slug the firm
-- already uses for a distilled page gains a '-handbook' suffix.
do $$
declare
  v_resources bigint;
  v_carried   bigint;
begin
  if to_regclass('public.resources') is null then
    return;
  end if;

  insert into public.kb_pages (
    firm_id, slug, kind, title, content_md, content_format, summary, jurisdiction, status, generated_by,
    author_id, author_name, pinned, version, created_at, updated_at,
    visible_to_roles, external_url, cover_image_path, legacy_resource_id
  )
  select
    r.firm_id,
    case when exists (select 1 from public.kb_pages k where k.firm_id = r.firm_id and k.slug = r.slug)
         then r.slug || '-handbook' else r.slug end,
    case when r.category in ('guide', 'policy', 'reference', 'announcement') then r.category else 'reference' end,
    r.title,
    coalesce(r.content, ''),
    'html',
    coalesce(r.excerpt, ''),
    '',
    case when r.is_published then 'published' else 'draft' end,
    'manual',
    r.author_id,
    r.author_name,
    coalesce(r.pinned, false),
    1,
    coalesce(r.created_at, now()),
    coalesce(r.updated_at, now()),
    r.visible_to_roles,
    r.external_url,
    r.cover_image_path,
    r.id
  from public.resources r
  where not exists (select 1 from public.kb_pages k where k.legacy_resource_id = r.id);

  select count(*) into v_resources from public.resources;
  select count(*) into v_carried
    from public.resources r
    join public.kb_pages k on k.legacy_resource_id = r.id and k.firm_id = r.firm_id;
  if v_carried <> v_resources then
    raise exception 'library merge: % of % resources rows carried over; leaving resources in place', v_carried, v_resources;
  end if;

  alter table public.resources rename to resources_legacy_20260928;
  revoke all on public.resources_legacy_20260928 from anon, authenticated;
end $$;

-- ── Visibility ──
-- Handbook pages can be limited to roles (the partner guide is partner-only);
-- admins and super_users see everything. The FOR ALL kb_pages_admin_write
-- policy also grants partners SELECT on every page of their firm — they
-- curate the Library.
drop policy if exists kb_pages_staff_select on public.kb_pages;
create policy kb_pages_staff_select on public.kb_pages
  for select to authenticated
  using (
    firm_id = public.current_firm_id()
    and public.current_person_id() is not null
    and (
      visible_to_roles is null
      or array_length(visible_to_roles, 1) is null
      or public."current_role"() = any (visible_to_roles)
      or public."current_role"() = any (array['admin'::text, 'super_user'::text])
    )
  );

-- ── Authoring ──
-- Lawyers write handbook pages (every write is audited and versioned); the
-- distilled kinds stay with partners and admins through kb_pages_admin_write,
-- which also owns deletes.
drop policy if exists kb_pages_author_handbook_insert on public.kb_pages;
create policy kb_pages_author_handbook_insert on public.kb_pages
  for insert to authenticated
  with check (
    firm_id = public.current_firm_id()
    and kind = any (array['guide'::text, 'policy'::text, 'reference'::text, 'announcement'::text])
    and public."current_role"() = any (array['lawyer'::text, 'partner'::text, 'admin'::text, 'super_user'::text])
  );

drop policy if exists kb_pages_author_handbook_update on public.kb_pages;
create policy kb_pages_author_handbook_update on public.kb_pages
  for update to authenticated
  using (
    firm_id = public.current_firm_id()
    and kind = any (array['guide'::text, 'policy'::text, 'reference'::text, 'announcement'::text])
    and public."current_role"() = any (array['lawyer'::text, 'partner'::text, 'admin'::text, 'super_user'::text])
  )
  with check (
    firm_id = public.current_firm_id()
    and kind = any (array['guide'::text, 'policy'::text, 'reference'::text, 'announcement'::text])
    and public."current_role"() = any (array['lawyer'::text, 'partner'::text, 'admin'::text, 'super_user'::text])
  );
