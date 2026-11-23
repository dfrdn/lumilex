# pg_cron jobs — live origin database, extracted 2026-08-22

**FOR REVIEW — these jobs are scheduled for consolidation into Vercel crons in Phase 5; do not blindly re-create.**

7 rows in `cron.job`. Command text is verbatim from the live DB. The `call_app_api` /
`call_app_api_post` helpers resolve `app_base_url` and `cron_secret` from Vault at runtime —
vault references stay symbolic here. Job 8 embeds the project's publishable anon key (not a
vault secret) directly in the command.

## Jobs

### jobid 1 — `notion-sync`
- schedule: `0 1 * * *`
- active: true
- command:
```sql
SELECT call_app_api('/api/sync')
```

### jobid 2 — `generate-notifications`
- schedule: `45 21 * * *`
- active: true
- command:
```sql
SELECT call_app_api('/api/notifications/generate')
```

### jobid 3 — `email-briefer`
- schedule: `0 22 * * 0-4`
- active: true
- command:
```sql
SELECT call_app_api('/api/notifications/email-briefer')
```

### jobid 4 — `auto-close-attendance`
- schedule: `0 21 * * *`
- active: true
- command:
```sql
SELECT call_app_api('/api/attendance/auto-close')
```

### jobid 8 — `backfill-sharepoint`
- schedule: `*/3 * * * *`
- active: true
- command:
```sql
SELECT net.http_post(
    url := 'https://<origin-project>.supabase.co/functions/v1/sharepoint-backfill',
    headers := jsonb_build_object('Authorization', 'Bearer <anon key redacted>', 'Content-Type', 'application/json'),
    body := '{"mode":"incoming"}'::jsonb
  )
```
Note: calls the `sharepoint-backfill` edge function; the bearer token was the project anon
(publishable) key; redacted here.

### jobid 11 — `backfill-file-analysis`
- schedule: `*/3 * * * *`
- active: true
- command:
```sql
SELECT call_app_api_post('/api/file-analysis/backfill', '{}'::jsonb)
```

### jobid 12 — `email-sync`
- schedule: `*/5 * * * *`
- active: true
- command:
```sql
SELECT call_app_api_post('/api/email/sync', '{}'::jsonb)
```

Job ids 5, 6, 7, 9, 10 do not exist (previously unscheduled).

## Vault secrets (names + descriptions ONLY — values never extracted)

| name | description |
|---|---|
| `app_base_url` | Base URL for the app |
| `cron_secret` | Secret for cron job auth |

These two secrets are read at runtime by `public.call_app_api(text)` and
`public.call_app_api_post(text, jsonb)` via `vault.decrypted_secrets`. When consolidating to
Vercel crons, equivalents must exist in the Vercel environment before the pg_cron jobs are
retired.
