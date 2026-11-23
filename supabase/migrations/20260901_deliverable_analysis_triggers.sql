-- Fire deliverable-version analysis from the database, so a filed deliverable is
-- indexed regardless of which path produced it (in-app, SQL editor, batch import).
--
-- This closes a gap open since 2f2a2d8e: that commit removed the in-app calls to
-- `triggerDeliverableVersionAnalysisIfFinalized` in favour of DB triggers, but the
-- triggers were written against the pre-baseline origin project and never reached
-- this one. The result is that /api/deliverable-analyze has had no caller at all —
-- `analyzed_by = 'auto'` is unreachable for deliverable versions, while the
-- equivalent path for incoming files (on_file_urls_changed) works. Deliverable
-- output therefore never enters file_analyses, and so never reaches the embeddings
-- corpus behind knowledge search.
--
-- Payloads carry firmId, per the convention 20260823_trigger_payloads_firm_id.sql
-- set for every other pg_net trigger: the receiving route scopes its service client
-- to that firm, and a mismatch makes the lookup a no-op rather than a cross-tenant
-- read. Both host tables carry firm_id NOT NULL, so NEW.firm_id is always present.

-- ── The finalized-status rule, defined once ──────────────────────────
-- Mirrors FINALIZED_STATUSES in lib/ai/auto-analyze.ts. Both triggers below ask
-- this rather than repeating the array, so the two cannot drift apart.
-- 'Filed or Sent out' is the external terminal state; 'Acknowledged' is the
-- internal one for memos, which never get filed externally.

CREATE OR REPLACE FUNCTION public.deliverable_status_is_finalized(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_status = ANY (ARRAY['Filed or Sent out', 'Acknowledged']);
$function$;

COMMENT ON FUNCTION public.deliverable_status_is_finalized(text) IS
  'True when a deliverable status means "produced and out the door". Mirrors FINALIZED_STATUSES in lib/ai/auto-analyze.ts; the deliverable-analysis triggers share this one definition.';

-- ── 1. Status transitions into a finalized state ─────────────────────
-- Fires only on a transition INTO finalized from a non-finalized state.
-- Filed→Submitted→Acknowledged is common, and the second hop is
-- finalized→finalized; the handler self-gates, but this saves the network hop.

CREATE OR REPLACE FUNCTION public.webhook_deliverable_status_finalized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF public.deliverable_status_is_finalized(NEW.status)
     AND (OLD.status IS NULL OR NOT public.deliverable_status_is_finalized(OLD.status))
  THEN
    PERFORM call_app_api_post(
      '/api/deliverable-analyze',
      jsonb_build_object('deliverableId', NEW.notion_id, 'firmId', NEW.firm_id)
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_deliverable_status_finalized ON public.deliverables;
CREATE TRIGGER on_deliverable_status_finalized
  AFTER UPDATE OF status ON public.deliverables
  FOR EACH ROW
  EXECUTE FUNCTION public.webhook_deliverable_status_finalized();

-- ── 2. A new version uploaded onto an already-finalized deliverable ──
-- The case trigger 1 cannot see: the deliverable was filed weeks ago and a
-- revised version lands now, with no status change to hook.
--
-- Gated on the parent's status inside the trigger. The origin-era version fired
-- unconditionally on every insert and let the endpoint decide, which meant an
-- HTTP POST per draft upload — at ~3.6 versions per deliverable, mostly for
-- drafts that were then skipped. The normal finalize order (upload final
-- version, then flip status) is handled by trigger 1, so an ungated POST here
-- is not just wasteful, it is never the path that does the work.

CREATE OR REPLACE FUNCTION public.webhook_deliverable_version_uploaded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.deliverables
  WHERE notion_id = NEW.deliverable_id;

  IF public.deliverable_status_is_finalized(v_status) THEN
    PERFORM call_app_api_post(
      '/api/deliverable-analyze',
      jsonb_build_object('deliverableId', NEW.deliverable_id, 'firmId', NEW.firm_id)
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_deliverable_version_uploaded ON public.deliverable_files;
CREATE TRIGGER on_deliverable_version_uploaded
  AFTER INSERT ON public.deliverable_files
  FOR EACH ROW
  EXECUTE FUNCTION public.webhook_deliverable_version_uploaded();

COMMENT ON FUNCTION public.webhook_deliverable_status_finalized() IS
  'POSTs /api/deliverable-analyze when a deliverable transitions into a finalized status. Paired with on_deliverable_version_uploaded, which covers a new version landing on an already-finalized deliverable.';

COMMENT ON FUNCTION public.webhook_deliverable_version_uploaded() IS
  'POSTs /api/deliverable-analyze when a version is added to an already-finalized deliverable. Skips drafts by checking the parent status; the normal finalize order is covered by on_deliverable_status_finalized.';
