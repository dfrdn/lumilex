# Auth migration — manual Supabase dashboard tasks

The code migration from NextAuth → Supabase Auth is complete. These dashboard settings are not reachable from MCP and need to be set manually before going to production.

## Required before cutover

1. **Disable open sign-ups.** Auth → Providers → Email → uncheck "Enable email sign-ups" (or set "Confirm email" off + "Allow new users to sign up" off). `supabase.auth.admin.createUser` from the set-password handler bypasses this, so admins can still invite team members.

2. **SMTP via Resend.** Auth → SMTP Settings → enable custom SMTP, point at Resend (`smtp.resend.com:465`, username `resend`, password = your Resend API key). Without this, password-reset emails ship from a generic `noreply@mail.app.supabase.io` sender — looks like phishing.

3. **Refresh token lifetime.** Auth → Sessions → set "Refresh token reuse interval" + "Inactivity timeout" so that idle users get ~30 days of grace before re-login (matches NextAuth's prior 30-day maxAge). Default is more aggressive than NextAuth was.

4. **Site URL + redirect URLs.** Auth → URL Configuration. Set Site URL to production domain. Add `http://localhost:3000` to additional redirect URLs for local dev.

## Email templates (recommended)

Auth → Email Templates. The "Reset Password" and "Invite User" templates are the only ones currently triggered by app flows. Customize them to match firm branding before any client-facing portal launch.

**Portal invite path note (2026-05-20):** the client-portal invite no longer calls `inviteUserByEmail` — it provisions the auth user silently via `admin.createUser({ email_confirm: true })`, mints a magic-link via `admin.generateLink`, and delivers via Resend (the firm's DKIM/SPF/DMARC-verified notifications address). The Supabase "Invite User" email template is therefore not triggered by app flows for portal users. Leave it customized as a fallback in case a future code path uses it, but it shouldn't be the production delivery channel.

If Auth → Email Templates → "Confirm signup" is enabled and you ever flip "Confirm email" back on in the Email provider settings, double-check that template too — or it'll start sending Supabase-SMTP emails to portal users on first sign-in.

## Verification

After flipping these:
- Try a wrong-password sign-in on `/login` → should show "Invalid email or password."
- Try password reset (when the flow is wired) → email should arrive from the firm-branded sender.
- Log in as a backfilled team member with their old password → should succeed.
