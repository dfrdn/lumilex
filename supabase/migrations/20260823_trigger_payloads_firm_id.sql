-- Multitenancy phase 5, wave 3: pg_net trigger payloads carry the row's firm_id.
-- Each function below is the live dev definition (pg_get_functiondef, 2026-08-23)
-- with exactly one change: the webhook call gains a firmId field (query param for
-- the one GET call). The receiving routes scope their service client to that firm;
-- a mismatched firmId makes the scoped lookup a no-op (fail-safe). Routes still
-- accept legacy payloads without firmId by resolving the firm from the row.
--
-- Trigger attachments are unchanged:
--   on_file_urls_changed            ON files          → webhook_file_uploaded
--   on_analysis_completed           ON file_analyses  → webhook_analysis_completed
--   on_deliverable_finalized_sync   ON deliverables   → webhook_deliverable_finalized
--   trg_refresh_summary_on_deliverable / _on_file / _on_hearing → queue_matter_summary_refresh
-- All host tables carry firm_id NOT NULL, so NEW.firm_id is always present.
-- (No deliverable-analyze or separate deliverable-file-finalized trigger exists
-- on the dev project — nothing to rewrite for those.)

CREATE OR REPLACE FUNCTION public.webhook_file_uploaded()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.file_urls IS DISTINCT FROM OLD.file_urls AND NEW.file_urls != '[]'::jsonb THEN
    -- Trigger auto-analysis for newly uploaded files
    PERFORM call_app_api('/api/file-analysis/auto?fileId=' || NEW.notion_id || '&firmId=' || NEW.firm_id);
    -- Trigger SharePoint sync for newly uploaded files
    PERFORM call_app_api_post(
      '/api/admin/sharepoint-sync',
      jsonb_build_object('fileNotionId', NEW.notion_id, 'firmId', NEW.firm_id)
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.webhook_analysis_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    PERFORM call_app_api_post('/api/embeddings/generate', jsonb_build_object('analysisId', NEW.id, 'firmId', NEW.firm_id));
  END IF;
  RETURN NEW;
END;
$function$;

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
        jsonb_build_object('deliverableId', NEW.notion_id, 'version', v_version, 'firmId', NEW.firm_id)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_matter_summary_refresh()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  _matter_id TEXT;
  _last_updated TIMESTAMPTZ;
  _base_url TEXT;
  _secret TEXT;
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

  SELECT decrypted_secret INTO _base_url FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
  SELECT decrypted_secret INTO _secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  IF _base_url IS NULL OR _secret IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := _base_url || '/api/matter-summary',
    body := jsonb_build_object('matterId', _matter_id, 'firmId', NEW.firm_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', _secret
    ),
    timeout_milliseconds := 30000
  );

  RETURN NEW;
END;
$function$;
