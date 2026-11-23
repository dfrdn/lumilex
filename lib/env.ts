import { getIntegrationKey } from '@/lib/firm/secrets';

// Platform env floor. These vars are required for the app to function at all;
// integrations (Anthropic, Graph, Resend, Voyage, VAPID, Firecrawl) are
// optional and gated by lib/firm/features.ts, not by their presence here — a
// self-hosted instance may run with no AI at all, and every AI feature then
// reports platform_unconfigured.
const REQUIRED_PLATFORM_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  // Absolute links in outbound email and push. Deliberately has no code-side
  // default: every default is one tenant's hostname handed to all the others.
  'APP_BASE_URL',
  // Seals firm_integrations.credentials_enc (lib/firm/secrets.ts). Required
  // outright rather than "required once some firm has credentials": that
  // condition can only be answered by querying the database, which would turn
  // a synchronous boot check into an async round-trip that fails OPEN on a
  // connection blip — and the moment it mattered would be the moment an
  // operator saved a firm's client secret. A hard boot failure is the cheaper
  // mistake.
  'INTEGRATION_CREDS_KEY',
] as const;

/**
 * Throws when any required platform env var is missing, listing all of them
 * at once. Called from instrumentation.ts so a misconfigured deployment fails
 * at boot instead of scattering runtime 500s.
 */
export function assertPlatformEnv(): void {
  const missing = REQUIRED_PLATFORM_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
    );
  }
  // Present but unusable is the same outage as absent, discovered later.
  getIntegrationKey();
}
