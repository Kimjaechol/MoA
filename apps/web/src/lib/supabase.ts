import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Client-side Supabase (anon key, RLS enforced) */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Server-side Supabase (service key, bypasses RLS) — only use in API routes */
export function getServiceSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_KEY is not set");
  }
  return createClient(supabaseUrl, serviceKey);
}
