/**
 * Claude is asked for JSON and usually returns it cleanly, but three failure
 * modes reach the parser in production, and a bare `JSON.parse` turns each into
 * a SyntaxError that permanently fails the row:
 *
 *   1. The object is wrapped in a markdown fence.
 *   2. The object is preceded or followed by prose ("Unexpected non-whitespace
 *      character after JSON at position 6029").
 *   3. The response hit `max_tokens` and stopped mid-object ("Unterminated
 *      string in JSON at position 15422").
 *
 * (1) and (2) are handled by scanning for the outermost balanced object and
 * ignoring everything around it. (3) is handled by rewinding to the last point
 * where a value was known-complete and closing the containers still open there,
 * which recovers every field that did finish rather than discarding the lot.
 */

type Closer = '}' | ']';

interface Checkpoint {
  /** Index to cut at — exclusive, and always just past a complete value. */
  end: number;
  /** Containers still open at that point, outermost first. */
  stack: Closer[];
}

interface ScanResult {
  complete: boolean;
  end: number;
  checkpoints: Checkpoint[];
}

/** Bound on how far back a salvage walks, so a pathological response can't go quadratic. */
const MAX_SALVAGE_ATTEMPTS = 64;

/**
 * Parse a JSON object or array out of a model response, tolerating fences,
 * surrounding prose, and truncation. Throws only when there is no recoverable
 * value at all.
 */
// `JSON.parse` returns `any`; keep the same ergonomics at the call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseJsonResponse<T = any>(raw: string): T {
  const text = raw.trim();
  const start = text.search(/[{[]/);
  if (start === -1) throw new Error('No JSON value found in response');

  const scan = scanJson(text, start);

  if (scan.complete) {
    try {
      return JSON.parse(text.slice(start, scan.end)) as T;
    } catch (err) {
      // Balanced but malformed inside — an unescaped control character, a stray
      // token. Salvage the fields that parsed before the bad byte rather than
      // discarding the whole analysis.
      const salvaged = salvage<T>(text, start, scan.checkpoints, errorPosition(err, scan.end));
      if (salvaged !== undefined) return salvaged;
      throw err;
    }
  }

  const salvaged = salvage<T>(text, start, scan.checkpoints, text.length);
  if (salvaged !== undefined) return salvaged;
  throw new Error('Response truncated before any complete value');
}

/**
 * Rewind to the latest checkpoint at or before `limit` that yields valid JSON
 * once its open containers are closed. Walks backwards because the checkpoint
 * nearest the fault keeps the most data.
 */
function salvage<T>(text: string, start: number, checkpoints: Checkpoint[], limit: number): T | undefined {
  let attempts = 0;

  for (let i = checkpoints.length - 1; i >= 0 && attempts < MAX_SALVAGE_ATTEMPTS; i--) {
    const cp = checkpoints[i];
    if (cp.end > limit) continue;
    attempts++;
    try {
      return JSON.parse(text.slice(start, cp.end) + [...cp.stack].reverse().join('')) as T;
    } catch {
      // This checkpoint still straddles the fault; try an earlier one.
    }
  }

  return undefined;
}

/** `SyntaxError` messages carry "at position N"; use it to start near the fault. */
function errorPosition(err: unknown, fallback: number): number {
  const match = err instanceof SyntaxError ? /at position (\d+)/.exec(err.message) : null;
  return match ? Number(match[1]) : fallback;
}

/**
 * Walk the text tracking string state and container depth. Checkpoints are
 * recorded only at a comma or a closing bracket — both guarantee that a
 * complete value precedes them, which a closing quote does not (it may be a
 * key, and `{"summary"}` is not valid JSON).
 */
function scanJson(text: string, start: number): ScanResult {
  const stack: Closer[] = [];
  const checkpoints: Checkpoint[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      stack.push('}');
    } else if (ch === '[') {
      stack.push(']');
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      if (stack.length === 0) return { complete: true, end: i + 1, checkpoints };
      checkpoints.push({ end: i + 1, stack: [...stack] });
    } else if (ch === ',' && stack.length > 0) {
      // Cut before the comma: the value that just ended is the last good one.
      checkpoints.push({ end: i, stack: [...stack] });
    }
  }

  return { complete: false, end: text.length, checkpoints };
}

/**
 * An array field from a forced tool call. On long tool inputs the model
 * sometimes sends the array JSON-encoded as a STRING — valid, complete, just
 * one level too serialized — and an `Array.isArray` check then discards every
 * element. Seen on Affidavit Review: a 37-question review returned all its
 * findings as a 30k-character string with `stop_reason: tool_use`, and the row
 * failed as "no findings". Decodes that case; anything else that is not an
 * array becomes empty.
 */
export function toolArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = parseJsonResponse(value);
    if (Array.isArray(parsed)) return parsed as T[];
    // The model sometimes serializes the whole tool input into the one array
    // field: `{"propositions": "{\"propositions\": [...]}"`. Unwrap an object
    // whose only array-valued property is the list we asked for.
    if (parsed && typeof parsed === 'object') {
      const arrays = Object.values(parsed as Record<string, unknown>).filter(Array.isArray);
      if (arrays.length === 1) return arrays[0] as T[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * A tool-input field that should be an object. Like array fields, the model
 * sometimes sends it serialized as a JSON string; read both. Null when it is
 * neither.
 */
export function toolObject<T extends object = Record<string, unknown>>(value: unknown): T | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as T;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = parseJsonResponse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}
