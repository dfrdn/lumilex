#!/usr/bin/env bash
# Point the lumilex-demo Vercel project at this repo's main branch and the
# demo's Supabase project, and serve it at demo.lumilex.co.
#
#   bash scripts/demo/vercel-setup.sh
#
# Run it yourself, logged in to the Vercel CLI. Secret values are read from
# .env.local and piped straight into `vercel env add`; nothing is printed. It
# is safe to re-run: each variable is removed and added again.
#
# What the demo gets, and why:
#   - The Supabase keys, Anthropic, Voyage and INTEGRATION_CREDS_KEY from
#     .env.local — the demo shares the test project, so it shares the key that
#     project's sealed credentials were sealed with.
#   - APP_BASE_URL=https://demo.lumilex.co.
#   - LUMILEX_INSTANCE_ROLE=demo. It is one of the three conditions on the
#     one-click sign-in (lib/demo/sign-in.ts).
#   - Production only: vercel.json's ignoreCommand builds main and nothing
#     else, so there are no preview deployments to configure.
#   - CRON_SECRET only when DEMO_CRON_SECRET is set. The test project's
#     webhooks send Vault's `cron_secret` to this deployment, so the two must
#     be one value; a fresh one generated here left every webhook refused with
#     401. To rotate, see "Deploying" in docs/demo-instance.md.
#   - No RESEND_API_KEY, no MS_* and no VAPID keys: nothing leaves the demo.
set -euo pipefail
cd "$(dirname "$0")/../.."

PROJECT=lumilex-demo
SCOPE=dfrdns-projects
DOMAIN=demo.lumilex.co

# The CLI need not be installed globally.
if ! command -v vercel >/dev/null 2>&1; then
  vercel() { npx --yes vercel@latest "$@"; }
fi
vercel whoami >/dev/null 2>&1 || vercel login

vercel link --yes --project "$PROJECT" --scope "$SCOPE"
vercel git connect --yes --scope "$SCOPE" || echo "  (git connect: already connected, or connect it in the dashboard)"

read_env() {
  local line
  line=$(grep -E "^$1=" .env.local | head -1 || true)
  line=${line#*=}
  line=${line#\"}; line=${line%\"}
  line=${line#\'}; line=${line%\'}
  printf '%s' "$line"
}

set_env() {
  local name=$1 value=$2
  shift 2
  if [ -z "$value" ]; then
    echo "  ! $name is empty in .env.local — skipped"
    return
  fi
  for target in "$@"; do
    vercel env rm "$name" "$target" --yes --scope "$SCOPE" >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$name" "$target" --scope "$SCOPE" >/dev/null
  done
  echo "  set $name ($*)"
}

for name in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY ANTHROPIC_API_KEY VOYAGE_API_KEY INTEGRATION_CREDS_KEY; do
  set_env "$name" "$(read_env "$name")" production
done
set_env APP_BASE_URL "https://$DOMAIN" production
set_env LUMILEX_INSTANCE_ROLE demo production
if [ -n "${DEMO_CRON_SECRET:-}" ]; then
  set_env CRON_SECRET "$DEMO_CRON_SECRET" production
else
  echo "  CRON_SECRET left as it is (set DEMO_CRON_SECRET to rotate it)"
fi

# Leftovers from the August demo, which branded itself through env vars.
for name in NEXT_PUBLIC_FIRM_NAME NEXT_PUBLIC_FIRM_SHORT_NAME NEXT_PUBLIC_FIRM_LEGAL_NAME \
  NEXT_PUBLIC_FIRM_LOGO NEXT_PUBLIC_FIRM_LOGO_ICON DEMO_PASSWORD DEMO_PROJECT_REF RESEND_API_KEY; do
  for target in production preview development; do
    vercel env rm "$name" "$target" --yes --scope "$SCOPE" >/dev/null 2>&1 || true
  done
done
echo "  removed the August demo's leftover variables, if any"

vercel domains add "$DOMAIN" "$PROJECT" --scope "$SCOPE" || echo "  (domain already on the project)"

echo
echo "Done. Remaining by hand:"
echo "  - GoDaddy DNS for lumilex.co: CNAME  demo  →  cname.vercel-dns.com"
echo "  - vercel env ls --scope $SCOPE   (check nothing else from August is left)"
echo "  - Deploy: push to main, or  vercel deploy --prod --scope $SCOPE"
