/**
 * Supabase Client Configuration
 *
 * Production database client for LawCall billing system.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface Database {
  public: {
    Tables: {
      lawcall_users: {
        Row: {
          id: string;
          kakao_user_id: string;
          credits: number;
          total_spent: number;
          custom_api_key: string | null;
          custom_provider: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          kakao_user_id: string;
          credits?: number;
          total_spent?: number;
          custom_api_key?: string | null;
          custom_provider?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          kakao_user_id?: string;
          credits?: number;
          total_spent?: number;
          custom_api_key?: string | null;
          custom_provider?: string | null;
          updated_at?: string;
        };
      };
      lawcall_usage: {
        Row: {
          id: string;
          user_id: string;
          model: string;
          input_tokens: number;
          output_tokens: number;
          credits_used: number;
          used_platform_key: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          model: string;
          input_tokens: number;
          output_tokens: number;
          credits_used: number;
          used_platform_key: boolean;
          created_at?: string;
        };
        Update: never;
      };
      lawcall_payments: {
        Row: {
          id: string;
          order_id: string;
          user_id: string;
          package_id: string;
          amount: number;
          credits: number;
          status: string;
          payment_key: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          user_id: string;
          package_id: string;
          amount: number;
          credits: number;
          status?: string;
          payment_key?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          status?: string;
          payment_key?: string | null;
          completed_at?: string | null;
        };
      };
    };
  };
}

let supabaseClient: SupabaseClient<Database> | null = null;

/**
 * Get Supabase client (singleton)
 */
export function getSupabase(): SupabaseClient<Database> {
  if (supabaseClient) return supabaseClient;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.",
    );
  }

  supabaseClient = createClient<Database>(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseClient;
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY));
}

/**
 * Test Supabase connection
 */
export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("lawcall_users").select("id").limit(1);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
