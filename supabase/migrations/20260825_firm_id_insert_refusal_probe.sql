-- firm_id_insert_refusal_probe(): the behavioural half of "no firm_id column
-- has a DEFAULT", for every tenant table rather than one sample.
--
-- 20260823_drop_transitional_firm_defaults.sql removed the transitional
-- dev-firm DEFAULT from all 130 tenant tables, so an insert that forgets
-- firm_id now raises 23502 instead of being silently filed under the dev firm.
-- A re-added default is the one regression scripts/audit-firm-id-stamping.ts
-- structurally cannot see — that gate reads TypeScript, and a column default
-- lives in the database. This function is what sees it.
--
-- Enumeration is from the catalog, using the same predicate as
-- tenant_tables(), so a table added tomorrow is covered tomorrow.
--
-- For each table it synthesises a row that FILLS every other NOT NULL column
-- without a default and omits ONLY firm_id. Filling the rest is what makes the
-- verdict mean anything: a bare insert fails on whichever NOT NULL column
-- sorts first, which proves nothing about firm_id. NOT NULL is checked before
-- CHECK constraints, RLS WITH CHECK and FK triggers, so with the rest of the
-- row present the one expected outcome is 23502 naming firm_id — reported as
-- 'refused_firm_id_not_null'. Every other verdict is a failure:
--
--   accepted                 the insert landed: a default (or a trigger) is
--                            supplying firm_id — the regression this exists for
--   refused_other_column     23502 on some other column: the synthesised row is
--                            incomplete, so this table was not actually tested
--   refused_other            23503/23514/22P02/… : firm_id was non-NULL by the
--                            time constraints ran, or the literal map is wrong
--   unsupported_column_type  no literal for some column's type — extend the map
--   firm_id_nullable         firm_id lost its NOT NULL
--
-- Nothing is ever committed. Each attempt runs in its own plpgsql
-- subtransaction, and an insert that SUCCEEDS is undone immediately by raising
-- ZX001 — so the failing case leaves no more debris than the passing one, and
-- the whole sweep is one round trip.
--
-- Identity and serial columns are pinned to an explicit value rather than left
-- to their DEFAULT. nextval() is non-transactional: letting the defaults fire
-- would burn one sequence value per table per run and survive the rollback,
-- which is the one way this could leave a mark on the database. Pinning them
-- (with OVERRIDING SYSTEM VALUE where the column is GENERATED ALWAYS) makes
-- the sweep completely inert — pg_sequences is byte-identical afterwards.
--
-- SECURITY INVOKER on purpose: the only caller is scripts/rls-probe.ts as
-- service_role (which bypasses RLS anyway), and a SECURITY DEFINER function
-- that can insert into every table in the schema is a larger thing to own than
-- this needs to be. Execution is service_role-only. It takes no arguments, so
-- there is no injection surface; every identifier comes from the catalog.

create or replace function public.firm_id_insert_refusal_probe()
returns table (
  table_name   text,
  verdict      text,
  error_state  text,
  error_column text,
  detail       text
)
language plpgsql
volatile
security invoker
set search_path = 'public', 'pg_temp'
as $fn$
declare
  t           record;
  c           record;
  col_list    text;
  val_list    text;
  lit         text;
  unsupported text;
  overriding  boolean;
  stmt        text;
  v_state     text;
  v_col       text;
  v_msg       text;
begin
  for t in
    select cl.oid,
           cl.relname::text as relname,
           fa.attnotnull    as firm_notnull,
           fa.atthasdef     as firm_hasdef,
           pg_get_expr(ad.adbin, ad.adrelid) as firm_default
      from pg_class cl
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute fa on fa.attrelid = cl.oid
                          and fa.attname  = 'firm_id'
                          and fa.attnum   > 0
                          and not fa.attisdropped
      left join pg_attrdef ad on ad.adrelid = cl.oid and ad.adnum = fa.attnum
     where ns.nspname = 'public'
       and cl.relkind = 'r'
     order by cl.relname
  loop
    table_name   := t.relname;
    verdict      := null;
    error_state  := null;
    error_column := null;
    detail       := null;

    if not t.firm_notnull then
      verdict := 'firm_id_nullable';
      detail  := 'firm_id is nullable — an insert that omits it cannot be refused';
      return next;
      continue;
    end if;

    col_list    := null;
    val_list    := null;
    unsupported := null;
    overriding  := false;

    for c in
      select a.attname::text as attname,
             a.atttypid,
             a.atttypmod,
             a.attidentity,
             ty.typcategory,
             ty.typname::text as typname,
             format_type(a.atttypid, a.atttypmod) as ftype
        from pg_attribute a
        join pg_type ty on ty.oid = a.atttypid
        left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
       where a.attrelid = t.oid
         and a.attnum   > 0
         and not a.attisdropped
         and a.attgenerated = ''
         and a.attname <> 'firm_id'
         and (
              -- a column the caller must supply
              (a.attnotnull and not a.atthasdef and a.attidentity = '')
              -- identity / serial: pinned so nextval() never fires (see header)
              or a.attidentity <> ''
              or (a.atthasdef and pg_get_expr(ad.adbin, ad.adrelid) like 'nextval(%')
             )
       order by a.attnum
    loop
      if c.attidentity = 'a' then overriding := true; end if;

      lit := case
        when c.typname in ('json', 'jsonb') then quote_literal('{}')
        when c.typname = 'uuid'             then quote_literal('00000000-0000-0000-0000-000000000000')
        when c.typname in ('time', 'timetz') then quote_literal('00:00:00')
        -- pgvector stores the declared dimension straight in atttypmod, and a
        -- wrong-length literal fails the cast before the insert is even
        -- attempted — which would read as a probe gap, not a pass.
        when c.typname = 'vector'           then quote_literal(
               '[' || array_to_string(
                        array_fill(0, array[greatest(coalesce(nullif(c.atttypmod, -1), 3), 1)]),
                        ',') || ']')
        when c.typcategory = 'S' then quote_literal('probe')
        when c.typcategory = 'N' then '0'
        when c.typcategory = 'B' then 'false'
        when c.typcategory = 'D' then quote_literal('2000-01-01')
        when c.typcategory = 'T' then quote_literal('0')
        when c.typcategory = 'A' then quote_literal('{}')
        when c.typcategory = 'I' then quote_literal('127.0.0.1')
        when c.typcategory = 'E' then quote_literal(
               (select e.enumlabel::text
                  from pg_enum e
                 where e.enumtypid = c.atttypid
                 order by e.enumsortorder
                 limit 1))
        else null
      end;

      if lit is null then
        unsupported := concat_ws(', ', unsupported, c.attname || ' ' || c.ftype);
        continue;
      end if;

      col_list := concat_ws(', ', col_list, quote_ident(c.attname));
      val_list := concat_ws(', ', val_list, lit || '::' || c.ftype);
    end loop;

    if unsupported is not null then
      verdict := 'unsupported_column_type';
      detail  := 'no literal for: ' || unsupported
              || ' — extend firm_id_insert_refusal_probe()''s type map';
      return next;
      continue;
    end if;

    if col_list is null then
      stmt := format('insert into public.%I default values', t.relname);
    else
      stmt := format('insert into public.%I (%s)%s values (%s)',
                     t.relname, col_list,
                     case when overriding then ' overriding system value' else '' end,
                     val_list);
    end if;

    begin
      execute stmt;
      -- The row landed. Undo it: the raise aborts this subtransaction, taking
      -- the insert (and any AFTER-trigger side effects) with it.
      raise exception 'probe insert accepted' using errcode = 'ZX001';
    exception
      when sqlstate 'ZX001' then
        verdict := 'accepted';
        detail  := 'insert omitting firm_id SUCCEEDED'
                || case when t.firm_hasdef
                        then ' — column default: ' || coalesce(t.firm_default, '(unreadable)')
                        else ' — no column default; a trigger supplied firm_id' end;
      when others then
        get stacked diagnostics
          v_state = returned_sqlstate,
          v_col   = column_name,
          v_msg   = message_text;
        error_state  := v_state;
        error_column := v_col;
        detail       := v_msg;
        if v_state = '23502' and v_col = 'firm_id' then
          verdict := 'refused_firm_id_not_null';
        elsif v_state = '42501' then
          verdict := 'refused_rls_with_check';
        elsif v_state = '23502' then
          verdict := 'refused_other_column';
        else
          verdict := 'refused_other';
        end if;
    end;

    return next;
  end loop;
end
$fn$;

revoke execute on function public.firm_id_insert_refusal_probe() from public;
revoke execute on function public.firm_id_insert_refusal_probe() from anon;
revoke execute on function public.firm_id_insert_refusal_probe() from authenticated;
grant execute on function public.firm_id_insert_refusal_probe() to service_role;
