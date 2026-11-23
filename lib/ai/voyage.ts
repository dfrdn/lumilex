// ── Voyage AI Embeddings Client ──────────────────────────────────────
// Uses voyage-law-2 model (1024 dimensions) optimized for legal text

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = 'voyage-law-2';
const MAX_BATCH_SIZE = 128;

function getApiKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY is not set');
  return key;
}

/**
 * Retry on rate-limit (429) with exponential backoff.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const is429 =
        err instanceof Error &&
        (err.message.includes('429') || err.message.includes('rate_limit'));
      if (!is429 || attempt === maxRetries) throw err;
      const waitMs = Math.min(60_000, 2 ** attempt * 10_000);
      console.log(
        `[voyage] Rate limited, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error('Unreachable');
}

interface VoyageResponse {
  data: { embedding: number[] }[];
  usage: { total_tokens: number };
}

/**
 * Embed a single text string (document mode).
 * Returns a 1024-dimension vector.
 */
export async function embedText(text: string): Promise<number[]> {
  const [result] = await embedTexts([text]);
  return result;
}

/**
 * Batch embed multiple texts (document mode).
 * Automatically splits into batches of 128 (Voyage limit).
 * Returns vectors in the same order as input.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);

    const response = await withRetry(async () => {
      const res = await fetch(VOYAGE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({
          model: VOYAGE_MODEL,
          input: batch,
          input_type: 'document',
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Voyage API error ${res.status}: ${body}`);
      }

      return (await res.json()) as VoyageResponse;
    });

    for (const item of response.data) {
      allVectors.push(item.embedding);
    }

    // Throttle between batches to avoid rate limits
    if (i + MAX_BATCH_SIZE < texts.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return allVectors;
}

/**
 * Embed a query (uses input_type: 'query' for better retrieval).
 */
export async function embedQuery(text: string): Promise<number[]> {
  const response = await withRetry(async () => {
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: VOYAGE_MODEL,
        input: [text],
        input_type: 'query',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage API error ${res.status}: ${body}`);
    }

    return (await res.json()) as VoyageResponse;
  });

  return response.data[0].embedding;
}

export function isVoyageConfigured(): boolean {
  return !!process.env.VOYAGE_API_KEY;
}
