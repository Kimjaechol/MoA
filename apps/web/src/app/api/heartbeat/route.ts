/**
 * GET /api/heartbeat
 * Proactive AI Agent Heartbeat — Vercel Cron Job
 *
 * This endpoint is called every minute by Vercel Cron to make MoA a proactive
 * AI agent instead of a passive chatbot. It:
 *
 *   1. Checks for completed async tasks and delivers results to users
 *   2. Reviews active conversations and sends proactive follow-ups
 *   3. Manages the heartbeat lifecycle (deduplication, rate limiting)
 *
 * This is what makes MoA fundamentally different from standard LLM chatbots:
 * the agent doesn't just respond — it proactively acts and follows up.
 *
 * Authentication: CRON_SECRET header (Vercel Cron sets this automatically)
 * Schedule: Every 1 minute (configured in vercel.json)
 *
 * Example flow:
 *   User: "이 정보를 기록해줘"
 *   MoA:  "정보를 기록해두겠습니다. 잠시만 기다려주세요."
 *   [30 seconds later, heartbeat fires]
 *   MoA:  "기록이 완료되었습니다. 다른 도움이 필요하신가요?"
 */

export const preferredRegion = "icn1";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for processing

import { NextRequest, NextResponse } from "next/server";
import { runHeartbeat } from "@/lib/heartbeat";

export async function GET(request: NextRequest) {
  // Authenticate: Vercel Cron sends CRON_SECRET automatically
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Check if heartbeat is enabled (operator can disable)
  if (process.env.HEARTBEAT_ENABLED === "false") {
    return NextResponse.json({ status: "disabled" });
  }

  try {
    // Get Supabase client
    let supabase;
    try {
      const { getServiceSupabase } = await import("@/lib/supabase");
      supabase = getServiceSupabase();
    } catch {
      return NextResponse.json({
        status: "skipped",
        reason: "Supabase not configured",
      });
    }

    // Run the heartbeat cycle
    const result = await runHeartbeat(supabase);

    return NextResponse.json({
      status: "ok",
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[heartbeat] Error:", err);
    return NextResponse.json({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
