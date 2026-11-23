/**
 * Pull the API's own `{ error }` message off a failed response so the UI can
 * show why a mutation was rejected instead of a generic "something went wrong".
 * Falls back when the body is empty, isn't JSON, or carries no usable message.
 */
export async function failureMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    const message = (body as { error?: unknown } | null)?.error;
    return typeof message === 'string' && message.trim() ? message : fallback;
  } catch {
    return fallback;
  }
}
