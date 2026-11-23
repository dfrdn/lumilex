import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Calendar days in Manila. Reading a day off an instant in UTC is the bug
  // behind every off-by-one date this codebase has shipped; lib/dates.ts holds
  // the Manila-aware replacements and is the one place allowed to do it.
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["lib/dates.ts", "lib/dates.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(slice|substring|substr)$/][callee.object.type='CallExpression'][callee.object.callee.property.name='toISOString']",
          message:
            "toISOString() is UTC; its first 10 characters are yesterday in Manila before 08:00. Use manilaToday(), toManilaDay(at), or for UTC-anchored day arithmetic addDays/addMonths/utcCalendarDay from @/lib/dates.",
        },
        {
          selector:
            "CallExpression[callee.property.name='split'][callee.object.type='CallExpression'][callee.object.callee.property.name='toISOString']",
          message:
            "toISOString().split('T')[0] is the UTC day, yesterday in Manila before 08:00. Use manilaToday(), toManilaDay(at), or utcCalendarDay from @/lib/dates.",
        },
        {
          selector:
            "NewExpression[callee.name='Date'] > CallExpression.arguments[callee.property.name='toLocaleString']",
          message:
            "Re-parsing a toLocaleString() wall clock reads it in the host zone — right on Vercel, wrong in a Manila browser. Use the helpers in @/lib/dates.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Multitenancy guard: app/lib code must not reach for the raw service-role
  // client. Firm-scoped access goes through getServiceDbForFirm.
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: [
      // PERMANENT allowlist. Every entry below reaches for the raw
      // service-role client for a reason that firm scoping cannot serve, and
      // each group says which. Adding a file here needs one of these reasons;
      // anything else belongs on getServiceDbForFirm.
      //
      // tenancy-machinery -- builds or fans out the firm-scoped client itself,
      // so it is the one place the raw client is the input rather than a leak.
      "lib/tenancy/**",
      //
      // session-bootstrap -- runs before a firmId exists (or, for the dev
      // impersonation endpoints, deliberately lists identities across firms;
      // both are 404 outside development).
      "lib/session.ts",
      "app/api/dev/portal-signin/route.ts",
      "app/api/dev/team-signin/route.ts",
      //
      // auth-admin -- supabase.auth.admin lives on the GoTrue side of the
      // client and has no firm dimension at all.
      "app/api/admin/users/route.ts",
      "app/api/auth/demo/route.ts",
      "app/api/clients/\\[id\\]/users/route.ts",
      "app/api/clients/\\[id\\]/users/\\[userId\\]/route.ts",
      "app/api/clients/\\[id\\]/users/\\[userId\\]/resend/route.ts",
      "app/api/user/change-password/route.ts",
      //
      // global-tables -- reads firms, firm_domains, ph_holidays, rule_sets,
      // rule_deadlines, agents or demo_access_requests, which are shared
      // across every tenant.
      "lib/agents/registry.ts",
      "lib/demo/access-store.ts",
      "lib/audit.ts",
      "lib/firm/config.ts",
      "lib/legal/court-rules.ts",
      "lib/legal/date-calculator.ts",
      //
      // platform-operator -- the ONE deliberately cross-tenant surface
      // (/platform). It is listed as its own group rather than folded into
      // global-tables above so that adding a file here is a decision someone
      // has to write down, which is the whole point of the friction.
      //
      // Both entries read GLOBAL tables only: `platform_operators` (the
      // operator identity, deny-by-default RLS, service-role its only reader)
      // and `firms` / `firm_domains` (the tenant enumeration). Neither reads a
      // TENANT table unscoped -- lib/platform/firms.ts loops the firms it
      // found and reads each one's team, integrations and invoice settings
      // back through getServiceDbForFirm(firm.id), so the facade still pins
      // every tenant query to a named firm. `verify:service-role` would fail
      // this list if that stopped being true, since it inspects the .from()
      // calls rather than trusting the entry.
      //
      // What is deliberately NOT done here: widening `firms_self_select`,
      // teaching getServiceDbForFirm a multi-firm mode, or granting the
      // authed client cross-firm reach. The operator path carries its own
      // authorization (lib/platform/auth.ts) instead, and nothing shared was
      // loosened to let it exist.
      "lib/platform/auth.ts",
      "lib/platform/firms.ts",
      //
      // storage -- supabase.storage handles are not scoped by the facade;
      // object keys are firm-prefixed with firmStoragePath instead.
      "app/api/file-sign/route.ts",
      "app/api/files/download/route.ts",
      "app/api/portal/file-sign/route.ts",
      "app/api/portal/files/download/route.ts",
      "app/api/portal/invoices/\\[id\\]/download/route.ts",
      "app/api/portal/matters/\\[id\\]/files/zip/route.ts",
      "app/api/proposals/\\[id\\]/export/route.ts",
      "app/api/red-team/route.ts",
      "lib/ai/auto-analyze.ts",
      "lib/ai/red-team.ts",
      "lib/assistant/tools.ts",
      "lib/billing/persist-invoice.ts",
      "lib/docx/billing-letter-template.ts",
      "lib/firm/brand-bytes.ts",
      "lib/pdf/brand-assets.ts",
      "lib/docx/resolution-generator.ts",
      "lib/issuances/pdf-snapshot.ts",
      "lib/queries/detail.ts",
      //
      // rpc -- the vector-match functions take no firm argument; the facade
      // passes rpc through untouched, so the firm filter is applied to the
      // returned matches by filterMatchesToFirm.
      "lib/ai/embeddings.ts",
      //
      // firm-resolution -- a payload, webhook or magic-link arrives with no
      // firmId, so the target row's own firm is read unscoped exactly once and
      // everything after it runs on the scoped client. Each of these carries
      // the marker comment `firm-resolution lookup: scoped client follows`.
      "app/api/admin/sharepoint-sync/route.ts",
      "app/api/auth/set-password/route.ts",
      "app/api/deliverable-analyze/route.ts",
      "app/api/embeddings/generate/route.ts",
      "app/api/file-analysis/auto/route.ts",
      "app/api/matter-summary/route.ts",
      "app/portal/auth/callback/route.ts",
      "lib/calendar/feed.ts",
      "lib/telegram/auth.ts",
      // -- TRANSITIONAL sweep list: shrink to zero in the service-role sweep --
      // (scripts/audit-service-role.ts parses this block; keep the markers.)
      // Empty: the sweep is complete. A file added here is a debt, not an
      // exemption -- give it a one-line reason and a plan to remove it.
      // -- end TRANSITIONAL sweep list --
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase",
              message:
                "Raw service-role client bypasses tenant scoping. Use getServiceDbForFirm(firmId) from @/lib/tenancy/service-db.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
