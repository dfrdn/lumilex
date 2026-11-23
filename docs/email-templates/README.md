# Supabase Auth email templates

Source of truth for the auth emails. The Supabase dashboard is where they actually live — these files are the version-controlled copies. When you change a template, update both.

## How to apply

Supabase dashboard → **Auth** → **Email Templates**. There's a dropdown to pick which template. For each one below:

1. **Subject** — set the subject line.
2. **Message body** — paste the full HTML from the corresponding file in this directory.

| Template (dashboard label) | Subject | File |
|---|---|---|
| Reset Password | Reset your Lumilex password | [reset-password.html](reset-password.html) |
| Invite User | You've been invited to Lumilex | [invite-user.html](invite-user.html) |
| Magic Link | Your Lumilex sign-in link | [magic-link.html](magic-link.html) |

The "Confirm signup" and "Change Email Address" templates aren't customized — open sign-ups are disabled and email changes are admin-only, so default copy is fine.

## Template variables

Supabase Auth interpolates these at send time. Don't escape them; paste as-is.

- `{{ .ConfirmationURL }}` — the action link (reset, invite, sign-in)
- `{{ .Email }}` — the recipient's email address
- `{{ .Token }}` / `{{ .TokenHash }}` — OTP forms; we don't use these
- `{{ .SiteURL }}` — base URL from Auth → URL Configuration

## Design — matches `wrapBrandedEmail` in [lib/email.ts](../../lib/email.ts)

Same chrome as the daily briefer and deliverable-transfer emails: dark navy header (`#1e293b`) with the firm's logo image, white card sections with `#e5e7eb` borders, navy CTA button, footer line referencing notification preferences. Update both `lib/email.ts:wrapBrandedEmail` and these files together if you ever rebrand.

Supabase Auth templates live in each instance's own project, so they are filled in per firm. Before pasting a template into a firm's dashboard, replace `YOUR FIRM NAME` with the firm's name and `https://YOUR-FIRM-DOMAIN/YOUR-LOGO.png` with an absolute URL to its logo (absolute because Gmail strips relative paths and base64).

If you want to adjust:
- **Brand color** — `#1e293b` is the chrome / CTA color, `#1a1a1a` is heading text. Both come from `wrapBrandedEmail`.
- **Copy** — body paragraphs are plain text inside `<p>` tags. Safe to edit freely.

## After updating

Send yourself a test email from the dashboard (each template has a "Send test email" button) to confirm rendering. Test in at least one Outlook client and one mobile Gmail before declaring done — those are the two most likely to surface CSS issues.
