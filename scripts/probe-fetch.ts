/**
 * The probes' HTTP client for requests against the dev server.
 *
 * `verify:storage` and `verify:platform` drive the real handlers on a running
 * `npm run dev`, with seconds of database work between requests. That gap is
 * where a connection-reuse race lives: Node's global undici dispatcher pools
 * keep-alive sockets, Next's HTTP server retires an idle one after ~5s, and if
 * the dispatcher picks a socket the server is closing at that moment the
 * request is written into a black hole. undici retries an idempotent request
 * itself — but not a POST, so the probe then waits out undici's default
 * `headersTimeout` of 300 SECONDS before throwing UND_ERR_HEADERS_TIMEOUT and
 * failing the whole chain.
 *
 * That is exactly how it presented once: a POST in storage-probe's handler
 * attack section, every check before it green, and the identical run passing
 * on a re-run with no code change. Measured first: an already-compiled API
 * route answers in ~4ms cold, so slow compilation was never the explanation.
 *
 * Two changes, both narrow:
 *
 *   1. An explicit timeout. A hung request now fails in seconds and says so,
 *      instead of stalling a CI job for five minutes.
 *   2. One retry, on a THROWN error only.
 *
 * **The retry cannot mask a real result.** It fires only when `fetch` itself
 * throws, which means no response existed to assert on; every probe assertion
 * reads a Response, and a Response is returned untouched, never retried. A
 * handler that answers 200 where the probe demands 403 still fails, as it must.
 *
 * The trade-off worth knowing: a retried POST may already have been executed
 * server-side before the socket died, so a side effect can happen twice. These
 * probes run against disposable per-run fixtures that are torn down either way,
 * and a double execution would surface as a loud assertion failure rather than
 * a silent pass — which is the right way round. Retries are logged for the same
 * reason: a probe that quietly papers over a flaky server is worse than one
 * that fails.
 */

/** A hung request should be obvious in seconds, not after undici's 300s. */
const TIMEOUT_MS = 20_000;
const RETRIES = 1;
const BACKOFF_MS = 250;

function describe(err: unknown): string {
  const e = err as { cause?: { code?: string }; name?: string; message?: string };
  return e?.cause?.code ?? e?.name ?? e?.message ?? String(err);
}

/**
 * `fetch` with a bounded timeout and one transport-level retry.
 * Drop-in for the probes' own request helpers.
 */
export async function probeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        // A caller-supplied signal wins: a probe that wants its own deadline
        // should get it.
        signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastErr = err;
      if (attempt === RETRIES) break;
      const method = (init.method ?? 'GET').toUpperCase();
      // Name the error, don't guess its cause: a dropped socket and a genuine
      // hang arrive here identically, and the module comment is where the
      // explanation belongs.
      console.warn(`  ⟳ ${method} ${url} — ${describe(err)}; retrying once`);
      await new Promise((r) => setTimeout(r, BACKOFF_MS));
    }
  }

  throw lastErr;
}
