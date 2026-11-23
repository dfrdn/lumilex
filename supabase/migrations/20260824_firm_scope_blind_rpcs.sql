-- Firm-scope the three remaining firm-blind RPCs (multitenancy follow-up §4).
--
-- All three are SECURITY INVOKER, so they inherit RLS when called on an authed
-- client — but all three are called on the service-role client, which bypasses
-- RLS entirely, and `.rpc()` passes straight through getServiceDbForFirm's
-- scoping facade (it only wraps `.from()`). So each was an unbounded cross-firm
-- read:
--
--   chat_unread_counts    scanned every firm's channels, messages and receipts
--   client_last_activity  aggregated every firm's matters, invoices, payments,
--                         DTR, deliverables, hearings, meetings, tasks, filings
--   matter_group_members  walked the related-matter graph across firms
--
-- None leaked output today — their inputs are firm-scoped person/matter ids, or
-- the caller drops unmatched rows in its own Map lookup — but each was one
-- refactor away from mattering, and each was doing far more work than asked.
--
-- Same shape as 20260823_firm_scope_conflict_rpcs.sql: p_firm_id first,
-- required, no default, so a stale call site fails to resolve (PGRST202) rather
-- than silently searching every firm. search_path is pinned on all three.
--
-- client_last_activity's `filings` branch is inlined against `deliverables`:
-- `filings` is a view (External deliverables with an external_due_date) and
-- exposes no firm_id, so there is nothing to filter it on.

drop function if exists public.chat_unread_counts(text[]);
drop function if exists public.client_last_activity();
drop function if exists public.matter_group_members(text);

create function public.chat_unread_counts(p_firm_id uuid, person_ids text[])
returns table(person_id text, unread bigint)
language sql
stable
set search_path = public, pg_temp
as $function$
  SELECT
    p.pid AS person_id,
    COUNT(m.id) AS unread
  FROM unnest(person_ids) AS p(pid)
  JOIN chat_channels c
    ON c.member_ids @> ARRAY[p.pid]
    AND c.firm_id = p_firm_id
  JOIN chat_messages m
    ON m.channel_id = c.id
    AND m.firm_id = p_firm_id
    AND m.sender_id <> p.pid
    AND m.deleted_at IS NULL
  LEFT JOIN chat_read_receipts r
    ON r.person_id = p.pid
    AND r.channel_id = c.id
    AND r.firm_id = p_firm_id
  WHERE m.created_at > COALESCE(r.last_read_at, 'epoch'::timestamptz)
  GROUP BY p.pid;
$function$;

create function public.client_last_activity(p_firm_id uuid)
returns table(client_id text, last_activity timestamp with time zone)
language sql
stable
set search_path = public, pg_temp
as $function$
  WITH activity(cid, ts) AS (
    SELECT client_id, created_time FROM matters
      WHERE firm_id = p_firm_id
    UNION ALL
    SELECT client_id, sent_date::timestamptz FROM invoices
      WHERE firm_id = p_firm_id
        AND status IN ('sent','partial','paid')
    UNION ALL
    SELECT i.client_id, p.payment_date::timestamptz
      FROM invoice_payments p
      JOIN invoices i ON i.id = p.invoice_id AND i.firm_id = p_firm_id
      WHERE p.firm_id = p_firm_id
    UNION ALL
    SELECT m.client_id, d.date::timestamptz
      FROM dtr d JOIN matters m ON m.notion_id = d.matter_id AND m.firm_id = p_firm_id
      WHERE d.firm_id = p_firm_id
    UNION ALL
    SELECT m.client_id, d.notion_last_edited_at
      FROM dtr d JOIN matters m ON m.notion_id = d.matter_id AND m.firm_id = p_firm_id
      WHERE d.firm_id = p_firm_id
    UNION ALL
    SELECT m.client_id, del.notion_last_edited_at
      FROM deliverables del JOIN matters m ON m.notion_id = del.matter_id AND m.firm_id = p_firm_id
      WHERE del.firm_id = p_firm_id
    UNION ALL
    SELECT m.client_id, h.date
      FROM hearings h JOIN matters m ON m.notion_id = h.matter_id AND m.firm_id = p_firm_id
      WHERE h.firm_id = p_firm_id
    UNION ALL
    SELECT m.client_id, h.notion_last_edited_at
      FROM hearings h JOIN matters m ON m.notion_id = h.matter_id AND m.firm_id = p_firm_id
      WHERE h.firm_id = p_firm_id
    UNION ALL
    SELECT m.client_id, mt.date_start
      FROM meetings mt JOIN matters m ON m.notion_id = mt.matter_id AND m.firm_id = p_firm_id
      WHERE mt.firm_id = p_firm_id
    UNION ALL
    SELECT m.client_id, mt.notion_last_edited_at
      FROM meetings mt JOIN matters m ON m.notion_id = mt.matter_id AND m.firm_id = p_firm_id
      WHERE mt.firm_id = p_firm_id
    UNION ALL
    SELECT m.client_id, t.notion_last_edited_at
      FROM tasks t JOIN matters m ON m.notion_id = t.matter_id AND m.firm_id = p_firm_id
      WHERE t.firm_id = p_firm_id
    UNION ALL
    -- The `filings` view, inlined: it carries no firm_id of its own.
    SELECT m.client_id, f.external_due_date::timestamptz
      FROM deliverables f JOIN matters m ON m.notion_id = f.matter_id AND m.firm_id = p_firm_id
      WHERE f.firm_id = p_firm_id
        AND f.type = 'External'
        AND f.external_due_date IS NOT NULL
  )
  SELECT cid AS client_id, MAX(ts) AS last_activity
  FROM activity
  WHERE cid IS NOT NULL
    AND ts IS NOT NULL
    AND ts <= now()
  GROUP BY cid;
$function$;

create function public.matter_group_members(p_firm_id uuid, seed_id text)
returns setof text
language sql
stable
set search_path = public, pg_temp
as $function$
  WITH RECURSIVE walk(id) AS (
    SELECT notion_id FROM matters
      WHERE notion_id = seed_id AND firm_id = p_firm_id
    UNION
    SELECT neighbor.id
    FROM walk w
    CROSS JOIN LATERAL (
      SELECT unnest(m.related_matter_ids) AS id
      FROM matters m
      WHERE m.notion_id = w.id AND m.firm_id = p_firm_id
      UNION
      SELECT m.notion_id AS id
      FROM matters m
      WHERE w.id = ANY(m.related_matter_ids) AND m.firm_id = p_firm_id
    ) AS neighbor
  )
  -- related_matter_ids is a bare text array with no FK behind it, so a dangling
  -- or foreign id can be walked into; the join is what keeps the returned set
  -- to matters this firm actually has.
  SELECT DISTINCT w.id
  FROM walk w
  JOIN matters m ON m.notion_id = w.id AND m.firm_id = p_firm_id;
$function$;
