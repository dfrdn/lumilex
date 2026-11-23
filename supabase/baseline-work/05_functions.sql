set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.allocate_client_code()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code integer;
  v_max integer;
begin
  if public."current_role"() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'allocate_client_code: caller is not authorized'
      using errcode = '42501';
  end if;

  select coalesce(max(client_code), 0) into v_max from public.clients;

  insert into public.client_code_counters as c (scope, last_code)
  values ('global', v_max + 1)
  on conflict (scope)
    do update set last_code = greatest(c.last_code, v_max) + 1
  returning c.last_code into v_code;

  return v_code;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.allocate_invoice_number(p_month text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_seq integer;
  v_max integer;
begin
  if public."current_role"() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'allocate_invoice_number: caller is not authorized'
      using errcode = '42501';
  end if;

  select coalesce(max((regexp_replace(invoice_number, '^INV-\d{4}-\d{2}-', ''))::int), 0)
    into v_max
  from public.invoices
  where billing_month = p_month
    and invoice_number ~ '^INV-\d{4}-\d{2}-\d+$';

  insert into public.invoice_number_counters as c (billing_month, last_seq)
  values (p_month, v_max + 1)
  on conflict (billing_month)
    do update set last_seq = greatest(c.last_seq, v_max) + 1
  returning c.last_seq into v_seq;

  return 'INV-' || p_month || '-' || lpad(v_seq::text, 3, '0');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.break_status_report_links_on_archive()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'Archived' AND (OLD.status IS DISTINCT FROM 'Archived') THEN
    IF NEW.type = 'Status Report' THEN
      UPDATE deliverables
      SET related_hearing_id = NULL,
          source_deliverable_id = NULL,
          source_file_id = NULL
      WHERE notion_id = NEW.notion_id;
    END IF;

    UPDATE deliverables
    SET source_deliverable_id = NULL
    WHERE source_deliverable_id = NEW.notion_id
      AND type = 'Status Report';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.call_app_api(path text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  base_url text;
  secret text;
BEGIN
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  RETURN net.http_get(
    url := base_url || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.call_app_api_post(path text, body jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  base_url text;
  secret text;
BEGIN
  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  RETURN net.http_post(
    url := base_url || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := body
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_email(p_email_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    public.current_person_id() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.emails e
        JOIN public.email_mailboxes mb ON mb.id = e.mailbox_id
        WHERE e.id = p_email_id
          AND (
            mb.mailbox_type = 'shared'
            OR mb.owner_person_id = public.current_person_id()
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.email_matter_links l
        WHERE l.email_id = p_email_id
          AND public.has_matter_access(l.matter_id)
      )
    );
$function$
;

CREATE OR REPLACE FUNCTION public.chat_unread_counts(person_ids text[])
 RETURNS TABLE(person_id text, unread bigint)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    p.pid AS person_id,
    COUNT(m.id) AS unread
  FROM unnest(person_ids) AS p(pid)
  JOIN chat_channels c ON c.member_ids @> ARRAY[p.pid]
  JOIN chat_messages m
    ON m.channel_id = c.id
    AND m.sender_id <> p.pid
    AND m.deleted_at IS NULL
  LEFT JOIN chat_read_receipts r
    ON r.person_id = p.pid
    AND r.channel_id = c.id
  WHERE m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)
  GROUP BY p.pid;
$function$
;

CREATE OR REPLACE FUNCTION public.check_client_name_conflicts(check_names text[], similarity_threshold double precision DEFAULT 0.3)
 RETURNS TABLE(client_id text, client_name text, full_company_name text, input_name text, similarity_score double precision, match_type text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  SELECT c.notion_id, c.name, c.full_company_name,
         cn.name AS input_name,
         GREATEST(
           similarity(lower(c.name), lower(cn.name)),
           CASE WHEN c.full_company_name != '' THEN similarity(lower(c.full_company_name), lower(cn.name)) ELSE 0 END
         )::FLOAT AS similarity_score,
         CASE
           WHEN lower(trim(c.name)) = lower(trim(cn.name)) THEN 'exact'
           WHEN c.full_company_name != '' AND lower(trim(c.full_company_name)) = lower(trim(cn.name)) THEN 'exact'
           ELSE 'fuzzy'
         END::TEXT AS match_type
  FROM clients c
  CROSS JOIN unnest(check_names) AS cn(name)
  WHERE c.name % cn.name
     OR (c.full_company_name != '' AND c.full_company_name % cn.name)
  ORDER BY similarity_score DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_name_conflicts(check_names text[], similarity_threshold double precision DEFAULT 0.3, max_results integer DEFAULT 50)
 RETURNS TABLE(matched_party_id bigint, matched_party_name text, matched_party_role text, matched_matter_id text, matched_matter_name text, matched_client_name text, input_name text, similarity_score double precision, match_type text)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
  RETURN QUERY
  -- Exact name matches
  SELECT p.id, p.party_name, p.party_role, p.matter_id,
         m.name, m.client_name,
         cn.name AS input_name,
         1.0::FLOAT AS similarity_score,
         'exact'::TEXT AS match_type
  FROM parties p
  JOIN matters m ON m.notion_id = p.matter_id
  CROSS JOIN unnest(check_names) AS cn(name)
  WHERE lower(trim(p.party_name)) = lower(trim(cn.name))

  UNION ALL

  -- Fuzzy name matches (trigram similarity)
  SELECT p.id, p.party_name, p.party_role, p.matter_id,
         m.name, m.client_name,
         cn.name AS input_name,
         similarity(lower(p.party_name), lower(cn.name))::FLOAT AS similarity_score,
         'fuzzy'::TEXT AS match_type
  FROM parties p
  JOIN matters m ON m.notion_id = p.matter_id
  CROSS JOIN unnest(check_names) AS cn(name)
  WHERE p.party_name % cn.name
    AND lower(trim(p.party_name)) != lower(trim(cn.name))
    AND similarity(lower(p.party_name), lower(cn.name)) >= similarity_threshold

  UNION ALL

  -- Alias matches
  SELECT p.id, p.party_name, p.party_role, p.matter_id,
         m.name, m.client_name,
         cn.name AS input_name,
         similarity(lower(alias), lower(cn.name))::FLOAT AS similarity_score,
         'alias'::TEXT AS match_type
  FROM parties p
  JOIN matters m ON m.notion_id = p.matter_id
  CROSS JOIN unnest(check_names) AS cn(name),
       unnest(p.aliases) AS alias
  WHERE alias % cn.name
    AND similarity(lower(alias), lower(cn.name)) >= similarity_threshold

  ORDER BY similarity_score DESC
  LIMIT max_results;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.clear_status_report_source_file_on_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE deliverables
  SET source_file_id = NULL
  WHERE source_file_id = OLD.notion_id
    AND type = 'Status Report';
  RETURN OLD;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.client_last_activity()
 RETURNS TABLE(client_id text, last_activity timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH activity(cid, ts) AS (
    SELECT client_id, created_time FROM matters
    UNION ALL
    SELECT client_id, sent_date::timestamptz FROM invoices
      WHERE status IN ('sent','partial','paid')
    UNION ALL
    SELECT i.client_id, p.payment_date::timestamptz
      FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
    UNION ALL
    SELECT m.client_id, d.date::timestamptz
      FROM dtr d JOIN matters m ON m.notion_id = d.matter_id
    UNION ALL
    SELECT m.client_id, d.notion_last_edited_at
      FROM dtr d JOIN matters m ON m.notion_id = d.matter_id
    UNION ALL
    SELECT m.client_id, del.notion_last_edited_at
      FROM deliverables del JOIN matters m ON m.notion_id = del.matter_id
    UNION ALL
    SELECT m.client_id, h.date
      FROM hearings h JOIN matters m ON m.notion_id = h.matter_id
    UNION ALL
    SELECT m.client_id, h.notion_last_edited_at
      FROM hearings h JOIN matters m ON m.notion_id = h.matter_id
    UNION ALL
    SELECT m.client_id, mt.date_start
      FROM meetings mt JOIN matters m ON m.notion_id = mt.matter_id
    UNION ALL
    SELECT m.client_id, mt.notion_last_edited_at
      FROM meetings mt JOIN matters m ON m.notion_id = mt.matter_id
    UNION ALL
    SELECT m.client_id, t.notion_last_edited_at
      FROM tasks t JOIN matters m ON m.notion_id = t.matter_id
    UNION ALL
    SELECT m.client_id, f.date::timestamptz
      FROM filings f JOIN matters m ON m.notion_id = f.matter_id
  )
  SELECT cid AS client_id, MAX(ts) AS last_activity
  FROM activity
  WHERE cid IS NOT NULL
    AND ts IS NOT NULL
    AND ts <= now()
  GROUP BY cid;
$function$
;

CREATE OR REPLACE FUNCTION public.clients_normalize_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN IF NEW.name IS NOT NULL THEN NEW.name := public.normalize_client_name(NEW.name); END IF; RETURN NEW; END; $function$
;

CREATE OR REPLACE FUNCTION public.corporations_derive_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'Dissolved' then
    return new;
  end if;

  if new.sec_registration_date is not null then
    if new.bir_cor_date is not null
       and (nullif(btrim(coalesce(new.business_permit_no, '')), '') is not null
            or new.business_permit_issued_date is not null)
    then
      new.status := 'Active';
    else
      new.status := 'Registered';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_email()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT email FROM public.team WHERE auth_user_id = auth.uid() AND active LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public.current_person_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT person_id FROM public.team WHERE auth_user_id = auth.uid() AND active LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public.current_person_identifiers()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT ARRAY[person_id, notion_id] FROM public.team WHERE auth_user_id = auth.uid() AND active LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public.current_person_name()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT name FROM public.team WHERE auth_user_id = auth.uid() AND active LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public."current_role"()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ SELECT role FROM public.team WHERE auth_user_id = auth.uid() AND active LIMIT 1 $function$
;

CREATE OR REPLACE FUNCTION public.deliverables_set_last_edited()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.notion_last_edited_at IS NOT DISTINCT FROM OLD.notion_last_edited_at THEN
    NEW.notion_last_edited_at := now();
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dtr_set_non_billable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.non_billable := COALESCE(NEW.remarks, '') ILIKE 'Status Report%';
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.dtr_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enum_options_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.exhibits_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.get_unbilled_client_names()
 RETURNS TABLE(client_name text)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT DISTINCT client_name
  FROM dtr
  WHERE billed = false
    AND client_name IS NOT NULL
    AND client_name != ''
  ORDER BY client_name;
$function$
;

CREATE OR REPLACE FUNCTION public.global_search(search_term text, max_per_type integer DEFAULT 5)
 RETURNS TABLE(entity_type text, id text, name text, subtitle text, route text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH ranked AS (
    -- Matters
    SELECT
      'matters'::text AS entity_type,
      notion_id AS id,
      m.name,
      concat_ws(' · ', m.matter_code, m.client_name) AS subtitle,
      '/dashboard/matters/' || notion_id AS route,
      CASE WHEN m.name ILIKE '%' || search_term || '%'
           OR m.matter_code ILIKE '%' || search_term || '%'
           OR m.client_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END AS is_exact,
      GREATEST(
        similarity(COALESCE(m.name, ''), search_term),
        similarity(COALESCE(m.matter_code, ''), search_term),
        similarity(COALESCE(m.client_name, ''), search_term)
      ) AS sim
    FROM matters m
    WHERE m.name ILIKE '%' || search_term || '%'
       OR m.matter_code ILIKE '%' || search_term || '%'
       OR m.client_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(m.name, ''), search_term) > 0.25
       OR similarity(COALESCE(m.matter_code, ''), search_term) > 0.25
       OR similarity(COALESCE(m.client_name, ''), search_term) > 0.25

    UNION ALL

    SELECT
      'clients'::text,
      notion_id,
      c.name,
      COALESCE(c.client_code::text, ''),
      '/dashboard/clients/' || notion_id,
      CASE WHEN c.name ILIKE '%' || search_term || '%'
           OR c.client_code::text ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(c.name, ''), search_term),
        similarity(COALESCE(c.client_code::text, ''), search_term)
      )
    FROM clients c
    WHERE c.name ILIKE '%' || search_term || '%'
       OR c.client_code::text ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(c.name, ''), search_term) > 0.25
       OR similarity(COALESCE(c.client_code::text, ''), search_term) > 0.25

    UNION ALL

    -- Deliverables (exclude archived)
    SELECT
      'deliverables'::text,
      notion_id,
      d.name,
      concat_ws(' · ', d.matter_name, d.client_name),
      '/dashboard/deliverables/' || notion_id,
      CASE WHEN d.name ILIKE '%' || search_term || '%'
           OR d.matter_name ILIKE '%' || search_term || '%'
           OR d.client_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(d.name, ''), search_term),
        similarity(COALESCE(d.matter_name, ''), search_term),
        similarity(COALESCE(d.client_name, ''), search_term)
      )
    FROM deliverables d
    WHERE d.status <> 'Archived'
      AND (
          d.name ILIKE '%' || search_term || '%'
       OR d.matter_name ILIKE '%' || search_term || '%'
       OR d.client_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(d.name, ''), search_term) > 0.25
       OR similarity(COALESCE(d.matter_name, ''), search_term) > 0.25
       OR similarity(COALESCE(d.client_name, ''), search_term) > 0.25
      )

    UNION ALL

    SELECT
      'tasks'::text,
      notion_id,
      t.name,
      COALESCE(t.matter_name, ''),
      '/dashboard/tasks/' || notion_id,
      CASE WHEN t.name ILIKE '%' || search_term || '%'
           OR t.matter_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(t.name, ''), search_term),
        similarity(COALESCE(t.matter_name, ''), search_term)
      )
    FROM tasks t
    WHERE t.name ILIKE '%' || search_term || '%'
       OR t.matter_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(t.name, ''), search_term) > 0.25
       OR similarity(COALESCE(t.matter_name, ''), search_term) > 0.25

    UNION ALL

    SELECT
      'meetings'::text,
      notion_id,
      mt.name,
      concat_ws(' · ', mt.type, mt.matter_name),
      '/dashboard/meetings/' || notion_id,
      CASE WHEN mt.name ILIKE '%' || search_term || '%'
           OR mt.matter_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(mt.name, ''), search_term),
        similarity(COALESCE(mt.matter_name, ''), search_term)
      )
    FROM meetings mt
    WHERE mt.name ILIKE '%' || search_term || '%'
       OR mt.matter_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(mt.name, ''), search_term) > 0.25
       OR similarity(COALESCE(mt.matter_name, ''), search_term) > 0.25

    UNION ALL

    SELECT
      'hearings'::text,
      notion_id,
      h.name,
      COALESCE(h.matter_name, ''),
      '/dashboard/hearings/' || notion_id,
      CASE WHEN h.name ILIKE '%' || search_term || '%'
           OR h.matter_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(h.name, ''), search_term),
        similarity(COALESCE(h.matter_name, ''), search_term)
      )
    FROM hearings h
    WHERE h.name ILIKE '%' || search_term || '%'
       OR h.matter_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(h.name, ''), search_term) > 0.25
       OR similarity(COALESCE(h.matter_name, ''), search_term) > 0.25

    UNION ALL

    -- Filings (view on deliverables — exclude archived)
    SELECT
      'filings'::text,
      notion_id,
      f.name,
      COALESCE(f.matter_name, ''),
      '/dashboard/filings/' || notion_id,
      CASE WHEN f.name ILIKE '%' || search_term || '%'
           OR f.matter_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(f.name, ''), search_term),
        similarity(COALESCE(f.matter_name, ''), search_term)
      )
    FROM filings f
    WHERE f.status <> 'Archived'
      AND (
          f.name ILIKE '%' || search_term || '%'
       OR f.matter_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(f.name, ''), search_term) > 0.25
       OR similarity(COALESCE(f.matter_name, ''), search_term) > 0.25
      )

    UNION ALL

    SELECT
      'files'::text,
      notion_id,
      fl.name,
      COALESCE(fl.matter_name, ''),
      '/dashboard/files/' || notion_id,
      CASE WHEN fl.name ILIKE '%' || search_term || '%'
           OR fl.matter_name ILIKE '%' || search_term || '%'
        THEN 1 ELSE 0 END,
      GREATEST(
        similarity(COALESCE(fl.name, ''), search_term),
        similarity(COALESCE(fl.matter_name, ''), search_term)
      )
    FROM files fl
    WHERE fl.name ILIKE '%' || search_term || '%'
       OR fl.matter_name ILIKE '%' || search_term || '%'
       OR similarity(COALESCE(fl.name, ''), search_term) > 0.25
       OR similarity(COALESCE(fl.matter_name, ''), search_term) > 0.25
  ),
  numbered AS (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY entity_type
        ORDER BY is_exact DESC, sim DESC
      ) AS rn
    FROM ranked
  )
  SELECT entity_type, id, name, subtitle, route
  FROM numbered
  WHERE rn <= max_per_type
  ORDER BY entity_type, is_exact DESC, sim DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.has_matter_access(p_matter_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.matters m
      WHERE m.notion_id = p_matter_id
        AND public.current_person_id() = ANY(m.team_person_ids)
    )
    OR public.current_role() IN ('partner','admin','super_user','finance','chief_liaison_officer','liaison_officer');
$function$
;

CREATE OR REPLACE FUNCTION public.match_embeddings(query_embedding vector, match_count integer DEFAULT 10, match_threshold double precision DEFAULT 0.3, filter_matter_id text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, source_type text, source_id text, matter_id text, chunk_index integer, chunk_text text, metadata jsonb, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    e.id,
    e.source_type,
    e.source_id,
    e.matter_id,
    e.chunk_index,
    e.chunk_text,
    e.metadata,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.embeddings e
  WHERE
    (filter_matter_id IS NULL OR e.matter_id = filter_matter_id)
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$function$
;

CREATE OR REPLACE FUNCTION public.match_embeddings_by_type(query_embedding vector, p_source_types text[], match_count integer DEFAULT 10, match_threshold double precision DEFAULT 0.25, filter_matter_id text DEFAULT NULL::text, p_meta_kinds text[] DEFAULT NULL::text[])
 RETURNS TABLE(id bigint, source_type text, source_id text, matter_id text, chunk_index integer, chunk_text text, metadata jsonb, similarity double precision)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    e.id, e.source_type, e.source_id, e.matter_id,
    e.chunk_index, e.chunk_text, e.metadata,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.embeddings e
  WHERE
    e.source_type = ANY(p_source_types)
    AND (filter_matter_id IS NULL OR e.matter_id = filter_matter_id)
    AND (p_meta_kinds IS NULL OR e.metadata->>'kind' = ANY(p_meta_kinds))
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$function$
;

CREATE OR REPLACE FUNCTION public.matter_group_members(seed_id text)
 RETURNS SETOF text
 LANGUAGE sql
 STABLE
AS $function$
  WITH RECURSIVE walk(id) AS (
    SELECT notion_id FROM matters WHERE notion_id = seed_id
    UNION
    SELECT neighbor.id
    FROM walk w
    CROSS JOIN LATERAL (
      SELECT unnest(m.related_matter_ids) AS id
      FROM matters m
      WHERE m.notion_id = w.id
      UNION
      SELECT m.notion_id AS id
      FROM matters m
      WHERE w.id = ANY(m.related_matter_ids)
    ) AS neighbor
  )
  SELECT DISTINCT id FROM walk;
$function$
;

CREATE OR REPLACE FUNCTION public.matters_recalc_client_status_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_client_status(OLD.client_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.client_id IS DISTINCT FROM NEW.client_id THEN
    PERFORM public.recalc_client_status(OLD.client_id);
  END IF;
  PERFORM public.recalc_client_status(NEW.client_id);
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_client_name(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT pg_catalog.btrim(p_name,
    chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)
    ||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)
    ||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)
    ||chr(8287)||chr(12288)||chr(65279))
$function$
;

CREATE OR REPLACE FUNCTION public.notification_priority(p_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_type
    when 'status_change'    then 'fyi'
    when 'leave_request'    then 'fyi'
    when 'feedback'         then 'fyi'
    when 'intake'           then 'fyi'
    when 'engagement_signed' then 'fyi'
    when 'client_upload'    then 'fyi'
    when 'email'            then 'fyi'
    else 'action'
  end
$function$
;

CREATE OR REPLACE FUNCTION public.notify_new_deliverable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only create notifications if there are drafters assigned
  IF NEW.drafter_ids IS NOT NULL AND array_length(NEW.drafter_ids, 1) > 0 THEN
    INSERT INTO notifications (person_id, type, title, body, href, entity_id)
    SELECT
      unnest(NEW.drafter_ids),
      'assignment',
      'New deliverable: ' || COALESCE(NEW.name, 'Untitled'),
      COALESCE(NEW.matter_name, '') || CASE WHEN NEW.external_due_date IS NOT NULL THEN ' — Due ' || NEW.external_due_date::text ELSE '' END,
      '/dashboard/deliverables/' || NEW.notion_id,
      NEW.notion_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.queue_matter_summary_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  _matter_id TEXT;
  _last_updated TIMESTAMPTZ;
BEGIN
  _matter_id := NEW.matter_id;

  IF _matter_id IS NULL OR _matter_id = '' THEN
    RETURN NEW;
  END IF;

  -- Debounce: skip if summary was refreshed in the last 5 minutes
  SELECT updated_at INTO _last_updated
  FROM matter_summaries
  WHERE matter_id = _matter_id;

  IF _last_updated IS NOT NULL AND _last_updated > now() - interval '5 minutes' THEN
    RETURN NEW;
  END IF;

  -- Queue async HTTP request via pg_net
  PERFORM net.http_post(
    url := 'https://app.example.invalid/api/matter-summary',
    body := jsonb_build_object('matterId', _matter_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<redacted: CRON_SECRET>'
    ),
    timeout_milliseconds := 30000
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recalc_client_status(p_client_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total   int;
  v_ongoing int;
  v_status  text;
BEGIN
  IF p_client_id IS NULL OR p_client_id = '' THEN RETURN; END IF;

  SELECT count(*), count(*) FILTER (WHERE lower(status) = 'ongoing')
    INTO v_total, v_ongoing
    FROM public.matters
   WHERE client_id = p_client_id;

  v_status := CASE
                WHEN v_total = 0   THEN 'Prospective'
                WHEN v_ongoing > 0 THEN 'Active'
                ELSE 'Inactive'
              END;

  UPDATE public.clients
     SET status = v_status
   WHERE notion_id = p_client_id
     AND status IS DISTINCT FROM v_status;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_evaluations_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_notification_priority()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.priority is null or new.priority = 'action' then
    new.priority := public.notification_priority(new.type);
  end if;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.set_notion_last_edited()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.notion_last_edited_at IS NOT DISTINCT FROM OLD.notion_last_edited_at THEN
    NEW.notion_last_edited_at := now();
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_matter_chat_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- The origin deployment listed four of its own staff here as standing
  -- members; 20260822_matter_chat_trigger_firm_scoped.sql replaces this
  -- function with one that derives them per firm.
  v_standing_members TEXT[] := ARRAY[]::TEXT[];
  v_merged_members TEXT[];
BEGIN
  -- Merge team members with standing admin/finance members (deduplicated)
  SELECT array_agg(DISTINCT elem ORDER BY elem)
  INTO v_merged_members
  FROM unnest(COALESCE(NEW.team_person_ids, '{}') || v_standing_members) AS elem;

  IF TG_OP = 'INSERT' THEN
    -- Create channel for new matter if one doesn't exist
    INSERT INTO chat_channels (type, matter_id, name, member_ids, created_by)
    VALUES (
      'matter',
      NEW.notion_id,
      NEW.name,
      v_merged_members,
      COALESCE(NEW.team_person_ids[1], v_standing_members[1])
    )
    ON CONFLICT (matter_id) DO NOTHING;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Update existing channel membership and name
    IF NEW.team_person_ids IS DISTINCT FROM OLD.team_person_ids
       OR NEW.name IS DISTINCT FROM OLD.name THEN
      UPDATE chat_channels
      SET member_ids = v_merged_members,
          name       = NEW.name,
          updated_at = now()
      WHERE matter_id = NEW.notion_id AND type = 'matter';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_matter_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  ev_ts timestamptz;
BEGIN
  IF NEW.matter_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    UPDATE public.matters
       SET last_activity_at = now()
     WHERE notion_id = NEW.matter_id
       AND status <> 'Archived';
    RETURN NEW;
  END IF;

  ev_ts := COALESCE((to_jsonb(NEW) ->> TG_ARGV[0])::timestamptz, now());
  IF ev_ts < now() - interval '60 days' THEN
    RETURN NEW;
  END IF;

  UPDATE public.matters
     SET last_activity_at = GREATEST(COALESCE(last_activity_at, 'epoch'::timestamptz), ev_ts)
   WHERE notion_id = NEW.matter_id;

  UPDATE public.matters
     SET status = 'Ongoing'
   WHERE notion_id = NEW.matter_id
     AND status = 'Archived';

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_matter_activity_via_channel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  m_id text;
BEGIN
  SELECT matter_id INTO m_id FROM public.chat_channels WHERE id = NEW.channel_id;
  IF m_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.matters
     SET last_activity_at = GREATEST(COALESCE(last_activity_at, 'epoch'::timestamptz), now())
   WHERE notion_id = m_id;

  UPDATE public.matters
     SET status = 'Ongoing'
   WHERE notion_id = m_id
     AND status = 'Archived';

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_client_deposits_apply()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.type = 'payment' THEN
      UPDATE clients
         SET receivables = COALESCE(receivables, 0) - NEW.amount,
             receivables_updated_at = now(),
             receivables_updated_by = NEW.recorded_by
       WHERE notion_id = NEW.client_id
          OR (NEW.client_id IS NULL AND name = NEW.client_name);
    ELSE
      UPDATE clients
         SET deposit_balance = COALESCE(deposit_balance, 0) + NEW.amount
       WHERE notion_id = NEW.client_id
          OR (NEW.client_id IS NULL AND name = NEW.client_name);
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.type = 'payment' THEN
      UPDATE clients
         SET receivables = COALESCE(receivables, 0) + OLD.amount,
             receivables_updated_at = now()
       WHERE notion_id = OLD.client_id
          OR (OLD.client_id IS NULL AND name = OLD.client_name);
    ELSE
      UPDATE clients
         SET deposit_balance = COALESCE(deposit_balance, 0) - OLD.amount
       WHERE notion_id = OLD.client_id
          OR (OLD.client_id IS NULL AND name = OLD.client_name);
    END IF;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.amount    IS NOT DISTINCT FROM OLD.amount
       AND NEW.type      IS NOT DISTINCT FROM OLD.type
       AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id THEN
      RETURN NEW;
    END IF;

    IF OLD.type = 'payment' THEN
      UPDATE clients
         SET receivables = COALESCE(receivables, 0) + OLD.amount,
             receivables_updated_at = now()
       WHERE notion_id = OLD.client_id
          OR (OLD.client_id IS NULL AND name = OLD.client_name);
    ELSE
      UPDATE clients
         SET deposit_balance = COALESCE(deposit_balance, 0) - OLD.amount
       WHERE notion_id = OLD.client_id
          OR (OLD.client_id IS NULL AND name = OLD.client_name);
    END IF;

    IF NEW.type = 'payment' THEN
      UPDATE clients
         SET receivables = COALESCE(receivables, 0) - NEW.amount,
             receivables_updated_at = now(),
             receivables_updated_by = NEW.recorded_by
       WHERE notion_id = NEW.client_id
          OR (NEW.client_id IS NULL AND name = NEW.client_name);
    ELSE
      UPDATE clients
         SET deposit_balance = COALESCE(deposit_balance, 0) + NEW.amount
       WHERE notion_id = NEW.client_id
          OR (NEW.client_id IS NULL AND name = NEW.client_name);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.webhook_analysis_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    PERFORM call_app_api_post('/api/embeddings/generate', jsonb_build_object('analysisId', NEW.id));
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.webhook_deliverable_finalized()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_version int;
BEGIN
  IF NEW.status = 'Outbox' AND OLD.status = 'Pre-finalized' THEN
    SELECT MAX(version) INTO v_version
    FROM public.deliverable_files
    WHERE deliverable_id = NEW.notion_id
      AND action = 'finalized';

    IF v_version IS NOT NULL THEN
      PERFORM call_app_api_post(
        '/api/admin/sharepoint-sync',
        jsonb_build_object('deliverableId', NEW.notion_id, 'version', v_version)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.webhook_file_uploaded()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.file_urls IS DISTINCT FROM OLD.file_urls AND NEW.file_urls != '[]'::jsonb THEN
    -- Trigger auto-analysis for newly uploaded files
    PERFORM call_app_api('/api/file-analysis/auto?fileId=' || NEW.notion_id);
    -- Trigger SharePoint sync for newly uploaded files
    PERFORM call_app_api_post(
      '/api/admin/sharepoint-sync',
      jsonb_build_object('fileNotionId', NEW.notion_id)
    );
  END IF;
  RETURN NEW;
END;
$function$
;
