/**
 * Semantic Cache — Upstash Vector + Redis based caching for LLM responses.
 *
 * Optimization 5: Reduces LLM API calls by caching similar questions.
 *
 * When Upstash is not configured, all operations gracefully return null/void
 * (no-op fallback). Zero impact on existing functionality.
 *
 * Env vars (optional):
 *   UPSTASH_VECTOR_REST_URL    — Upstash Vector REST endpoint
 *   UPSTASH_VECTOR_REST_TOKEN  — Upstash Vector auth token
 *   UPSTASH_REDIS_REST_URL     — Upstash Redis REST endpoint
 *   UPSTASH_REDIS_REST_TOKEN   — Upstash Redis auth token
 */

// Category-specific cache TTL in seconds
const CACHE_TTL: Record<string, number> = {
  daily: 3600,      // 1 hour (weather, news change frequently)
  work: 86400,      // 24 hours
  document: 86400,  // 24 hours
  coding: 604800,   // 7 days (code answers are stable)
  image: 7200,      // 2 hours
  music: 86400,     // 24 hours
  other: 7200,      // 2 hours
};

// Minimum similarity score for cache hit (0.0 - 1.0)
const SIMILARITY_THRESHOLD = 0.92;

function isConfigured(): boolean {
  return !!(
    process.env.UPSTASH_VECTOR_REST_URL &&
    process.env.UPSTASH_VECTOR_REST_TOKEN &&
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

// ────────────────────────────────────────────
// Upstash Vector REST API (no SDK dependency)
// ────────────────────────────────────────────

async function vectorQuery(data: string, filter?: string): Promise<{ id: string; score: number }[]> {
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) return [];

  try {
    const res = await fetch(`${url}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        data,
        topK: 1,
        includeMetadata: false,
        ...(filter ? { filter } : {}),
      }),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return body.result ?? [];
  } catch {
    return [];
  }
}

async function vectorUpsert(id: string, data: string, metadata: Record<string, string>): Promise<void> {
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) return;

  try {
    await fetch(`${url}/upsert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, data, metadata }),
    });
  } catch { /* best-effort */ }
}

// ────────────────────────────────────────────
// Upstash Redis REST API (no SDK dependency)
// ────────────────────────────────────────────

async function redisGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.result ?? null;
  } catch {
    return null;
  }
}

async function redisSetEx(key: string, value: string, ttl: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;

  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${ttl}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* best-effort */ }
}

// ────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────

/**
 * Look up a semantically similar cached response.
 * Returns the cached text if similarity >= threshold, else null.
 */
export async function getCachedResponse(message: string, category: string): Promise<string | null> {
  if (!isConfigured()) return null;

  try {
    const results = await vectorQuery(message, `category = '${category}'`);
    if (results.length === 0 || results[0].score < SIMILARITY_THRESHOLD) return null;

    const cached = await redisGet(`moa:cache:${results[0].id}`);
    return cached;
  } catch {
    return null;
  }
}

/**
 * Store a response in the semantic cache.
 * Associates the message embedding with the response text.
 */
export async function setCachedResponse(message: string, category: string, response: string): Promise<void> {
  if (!isConfigured()) return;

  try {
    const id = crypto.randomUUID();
    const ttl = CACHE_TTL[category] ?? 7200;

    await Promise.all([
      vectorUpsert(id, message, { category }),
      redisSetEx(`moa:cache:${id}`, response, ttl),
    ]);
  } catch { /* best-effort */ }
}
