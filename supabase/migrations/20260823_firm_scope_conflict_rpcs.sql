-- Firm-scope the conflict-of-interest RPCs.
--
-- Both functions are SECURITY INVOKER, so they inherit RLS when called on an
-- authed client. lib/conflicts/check.ts calls them on the service-role client
-- (the check has to see rows the requesting lawyer cannot), which bypasses RLS
-- entirely — so before this migration a conflict check matched parties and
-- clients belonging to every firm on the instance. That is both a disclosure
-- (one firm's client and adverse-party names surfacing in another's intake
-- screen) and a correctness bug (a "conflict" against a matter the firm has
-- never had).
--
-- p_firm_id is required and has no default: an old two/three-argument call site
-- fails to resolve rather than silently searching every firm.

drop function if exists public.check_name_conflicts(text[], double precision, integer);
drop function if exists public.check_client_name_conflicts(text[], double precision);

create function public.check_client_name_conflicts(
  p_firm_id uuid,
  check_names text[],
  similarity_threshold double precision default 0.3
)
returns table(
  client_id text,
  client_name text,
  full_company_name text,
  input_name text,
  similarity_score double precision,
  match_type text
)
language plpgsql
stable
set search_path = public, pg_temp
as $function$
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
  WHERE c.firm_id = p_firm_id
    AND (c.name % cn.name
      OR (c.full_company_name != '' AND c.full_company_name % cn.name))
  ORDER BY similarity_score DESC;
END;
$function$;

create function public.check_name_conflicts(
  p_firm_id uuid,
  check_names text[],
  similarity_threshold double precision default 0.3,
  max_results integer default 50
)
returns table(
  matched_party_id bigint,
  matched_party_name text,
  matched_party_role text,
  matched_matter_id text,
  matched_matter_name text,
  matched_client_name text,
  input_name text,
  similarity_score double precision,
  match_type text
)
language plpgsql
stable
set search_path = public, pg_temp
as $function$
BEGIN
  RETURN QUERY
  -- Exact name matches
  SELECT p.id, p.party_name, p.party_role, p.matter_id,
         m.name, m.client_name,
         cn.name AS input_name,
         1.0::FLOAT AS similarity_score,
         'exact'::TEXT AS match_type
  FROM parties p
  JOIN matters m ON m.notion_id = p.matter_id AND m.firm_id = p.firm_id
  CROSS JOIN unnest(check_names) AS cn(name)
  WHERE p.firm_id = p_firm_id
    AND lower(trim(p.party_name)) = lower(trim(cn.name))

  UNION ALL

  -- Fuzzy name matches (trigram similarity)
  SELECT p.id, p.party_name, p.party_role, p.matter_id,
         m.name, m.client_name,
         cn.name AS input_name,
         similarity(lower(p.party_name), lower(cn.name))::FLOAT AS similarity_score,
         'fuzzy'::TEXT AS match_type
  FROM parties p
  JOIN matters m ON m.notion_id = p.matter_id AND m.firm_id = p.firm_id
  CROSS JOIN unnest(check_names) AS cn(name)
  WHERE p.firm_id = p_firm_id
    AND p.party_name % cn.name
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
  JOIN matters m ON m.notion_id = p.matter_id AND m.firm_id = p.firm_id
  CROSS JOIN unnest(check_names) AS cn(name),
       unnest(p.aliases) AS alias
  WHERE p.firm_id = p_firm_id
    AND alias % cn.name
    AND similarity(lower(alias), lower(cn.name)) >= similarity_threshold

  ORDER BY similarity_score DESC
  LIMIT max_results;
END;
$function$;
