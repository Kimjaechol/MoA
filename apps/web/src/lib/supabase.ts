import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Lazy-initialized Supabase clients.
 * Avoids crashing at build time when env vars are not yet available.
 */

let _anonClient: SupabaseClient | null = null;

/** Client-side Supabase (anon key, RLS enforced) */
export function getSupabase(): SupabaseClient {
  if (!_anonClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL or SUPABASE_ANON_KEY is not set");
    }
    _anonClient = createClient(url, key);
  }
  return _anonClient;
}

/** Backward-compatible alias — lazy initialized */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/** Server-side Supabase (service key, bypasses RLS) — only use in API routes */
export function getServiceSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY is not set");
  }
  return createClient(url, serviceKey);
}
