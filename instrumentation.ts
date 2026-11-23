// Imported lazily: instrumentation is loaded on the edge runtime too, and the
// env check reaches node:crypto to validate INTEGRATION_CREDS_KEY.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertPlatformEnv } = await import('@/lib/env');
    assertPlatformEnv();
  }
}
