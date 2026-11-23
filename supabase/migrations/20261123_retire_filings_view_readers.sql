-- The last database reader of the `filings` view reads deliverables directly.
-- The view is `deliverables WHERE type = 'External' AND external_due_date IS
-- NOT NULL` (security_invoker, so RLS on deliverables applies either way), and
-- global_search reads no column the view renamed, so the body below is the
-- baseline definition with the view's filter written out and returns the same
-- rows. Its filing routes still read /dashboard/filings/<id>, which redirects
-- to the deliverable. client_last_activity already inlined the view. The view
-- is dropped by 20261123_drop_filings_view.sql once no deployed build reads it.
-- CREATE OR REPLACE keeps the function's existing grants.

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

    -- Filings: external deliverables with a due date, read directly rather
    -- than through the retired `filings` view (exclude archived)
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
    FROM deliverables f
    WHERE f.type = 'External'
      AND f.external_due_date IS NOT NULL
      AND f.status <> 'Archived'
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
$function$;
