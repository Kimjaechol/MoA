/**
 * MoA Heartbeat System — Proactive AI Agent
 *
 * This is what makes MoA fundamentally different from passive LLM chatbots.
 * Instead of only responding when the user sends a message, the agent
 * proactively follows up:
 *
 *   1. After completing async tasks → reports results back to user
 *   2. After conversation pauses → checks if user needs more help
 *   3. On pending tasks → reviews context and acts autonomously
 *
 * Architecture (Vercel-compatible):
 *   - /api/heartbeat (Vercel Cron, every 1 min) → checks all active sessions
 *   - moa_pending_tasks table → tracks tasks the agent is working on
 *   - moa_heartbeat_log → prevents duplicate proactive messages
 *   - Chat UI polls for new messages → displays heartbeat follow-ups seamlessly
 *
 * Inspired by OpenClaw's heartbeat-runner.ts, adapted for serverless.
 */

import { generateAIResponse, detectCategory } from "@/lib/ai-engine";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface PendingTask {
  id: string;
  user_id: string;
  session_id: string;
  channel: string;
  task_type: "async_action" | "follow_up" | "reminder" | "proactive_check";
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  context: string; // Last conversation context for the agent
  created_at: string;
  completed_at?: string;
  result?: string;
  delivered: boolean;
}

export interface HeartbeatResult {
  processed: number;
  delivered: number;
  skipped: number;
  errors: string[];
}

// ────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────

/** Min seconds since last user message before sending a follow-up */
const FOLLOW_UP_DELAY_SEC = 30;

/** Max follow-ups per session per hour (prevent spam) */
const MAX_FOLLOW_UPS_PER_HOUR = 3;

/** Heartbeat deduplication window (ms) — don't send same message twice */
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Max pending tasks to process per heartbeat run */
const MAX_TASKS_PER_RUN = 10;

// ────────────────────────────────────────────
// Heartbeat Token (OpenClaw pattern)
// ────────────────────────────────────────────

const HEARTBEAT_OK = "HEARTBEAT_OK";

/**
 * Strip HEARTBEAT_OK token from agent response.
 * If the response is just the token (with minimal text), return null
 * to suppress the message. Otherwise, return the cleaned text.
 */
function stripHeartbeatToken(text: string): string | null {
  const stripped = text
    .replace(/\*\*HEARTBEAT_OK\*\*/gi, "")
    .replace(/<b>HEARTBEAT_OK<\/b>/gi, "")
    .replace(/HEARTBEAT_OK/gi, "")
    .trim();

  // If less than 20 meaningful chars after stripping, suppress
  if (stripped.length < 20) return null;
  return stripped;
}

// ────────────────────────────────────────────
// Task Management (Supabase)
// ────────────────────────────────────────────

/**
 * Create a pending task for the heartbeat to pick up.
 * Called when the AI says "I'll work on that" or starts an async operation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createPendingTask(supabase: any, task: {
  userId: string;
  sessionId: string;
  channel: string;
  taskType: PendingTask["task_type"];
  description: string;
  context: string;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("moa_pending_tasks")
      .insert({
        user_id: task.userId,
        session_id: task.sessionId,
        channel: task.channel,
        task_type: task.taskType,
        description: task.description,
        status: "pending",
        context: task.context,
        delivered: false,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[heartbeat] Failed to create task:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("[heartbeat] createPendingTask error:", err);
    return null;
  }
}

/**
 * Mark a task as completed with result.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function completeTask(supabase: any, taskId: string, result: string): Promise<void> {
  try {
    await supabase
      .from("moa_pending_tasks")
      .update({
        status: "completed",
        result,
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId);
  } catch (err) {
    console.error("[heartbeat] completeTask error:", err);
  }
}

// ────────────────────────────────────────────
// Heartbeat Runner (called by /api/heartbeat cron)
// ────────────────────────────────────────────

/**
 * Run a single heartbeat cycle.
 * Checks for:
 *   1. Completed tasks that haven't been delivered to users
 *   2. Active sessions that might need proactive follow-up
 *
 * Returns summary of what was processed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runHeartbeat(supabase: any): Promise<HeartbeatResult> {
  const result: HeartbeatResult = {
    processed: 0,
    delivered: 0,
    skipped: 0,
    errors: [],
  };

  // 1. Process completed tasks that need delivery
  await processCompletedTasks(supabase, result);

  // 2. Check for sessions that need proactive follow-up
  await processProactiveFollowUps(supabase, result);

  return result;
}

/**
 * Process completed tasks and deliver results to users.
 * This handles the "잠시만 기다려주세요" → "기록이 끝났습니다" pattern.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processCompletedTasks(supabase: any, result: HeartbeatResult): Promise<void> {
  try {
    const { data: tasks, error } = await supabase
      .from("moa_pending_tasks")
      .select("*")
      .eq("status", "completed")
      .eq("delivered", false)
      .order("completed_at", { ascending: true })
      .limit(MAX_TASKS_PER_RUN);

    if (error || !tasks?.length) return;

    for (const task of tasks as PendingTask[]) {
      result.processed++;

      try {
        // Generate a natural follow-up message based on the task result
        const followUpPrompt = buildTaskCompletionPrompt(task);

        const aiResult = await generateAIResponse({
          message: followUpPrompt,
          userId: task.user_id,
          sessionId: task.session_id,
          channel: task.channel,
          category: detectCategory(task.description),
        });

        // Strip HEARTBEAT_OK if agent says nothing meaningful
        const cleanReply = stripHeartbeatToken(aiResult.reply);

        if (cleanReply) {
          // Save the proactive message as an assistant message
          await supabase.from("moa_chat_messages").insert({
            user_id: task.user_id,
            session_id: task.session_id,
            role: "assistant",
            content: cleanReply,
            channel: task.channel,
            model_used: `heartbeat/${aiResult.model}`,
            category: "proactive",
          });
          result.delivered++;
        } else {
          result.skipped++;
        }

        // Mark task as delivered
        await supabase
          .from("moa_pending_tasks")
          .update({ delivered: true })
          .eq("id", task.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Task ${task.id}: ${msg}`);
      }
    }
  } catch (err) {
    result.errors.push(`processCompletedTasks: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Check for active sessions that might benefit from proactive follow-up.
 * Like OpenClaw's heartbeat, this reviews conversation context and
 * decides whether to initiate contact.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processProactiveFollowUps(supabase: any, result: HeartbeatResult): Promise<void> {
  try {
    // Find sessions with recent activity but no recent heartbeat
    const cutoff = new Date(Date.now() - FOLLOW_UP_DELAY_SEC * 1000).toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Get recent sessions where:
    // 1. Last assistant message was an action/promise (has pending work)
    // 2. No heartbeat sent in the last hour
    const { data: recentSessions, error } = await supabase
      .from("moa_chat_messages")
      .select("user_id, session_id, channel, content, role, created_at")
      .gte("created_at", hourAgo)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error || !recentSessions?.length) return;

    // Group by session and find sessions needing follow-up
    const sessionMap = new Map<string, {
      userId: string;
      sessionId: string;
      channel: string;
      lastAssistantMsg: string;
      lastAssistantTime: string;
      lastUserMsg: string;
      lastUserTime: string;
      messageCount: number;
    }>();

    for (const msg of recentSessions as Array<{
      user_id: string;
      session_id: string;
      channel: string;
      content: string;
      role: string;
      created_at: string;
    }>) {
      const key = `${msg.user_id}:${msg.session_id}`;
      if (!sessionMap.has(key)) {
        sessionMap.set(key, {
          userId: msg.user_id,
          sessionId: msg.session_id,
          channel: msg.channel,
          lastAssistantMsg: "",
          lastAssistantTime: "",
          lastUserMsg: "",
          lastUserTime: "",
          messageCount: 0,
        });
      }
      const session = sessionMap.get(key)!;
      session.messageCount++;

      if (msg.role === "assistant" && !session.lastAssistantMsg) {
        session.lastAssistantMsg = msg.content;
        session.lastAssistantTime = msg.created_at;
      }
      if (msg.role === "user" && !session.lastUserMsg) {
        session.lastUserMsg = msg.content;
        session.lastUserTime = msg.created_at;
      }
    }

    // Check each session for proactive follow-up opportunity
    for (const [, session] of sessionMap) {
      // Skip if no assistant message or conversation is still active
      if (!session.lastAssistantMsg || !session.lastUserMsg) continue;

      // Skip if last message was from the user (they're waiting for a response)
      if (session.lastUserTime > session.lastAssistantTime) continue;

      // Skip if last assistant message is too old (> 1 hour)
      if (new Date(session.lastAssistantTime).getTime() < Date.now() - 60 * 60 * 1000) continue;

      // Check if the last assistant message indicates pending work
      const needsFollowUp = detectPendingWork(session.lastAssistantMsg);
      if (!needsFollowUp) continue;

      // Check rate limit (max follow-ups per hour)
      const { count: recentHeartbeats } = await supabase
        .from("moa_chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", session.userId)
        .eq("session_id", session.sessionId)
        .eq("category", "proactive")
        .gte("created_at", hourAgo);

      if ((recentHeartbeats ?? 0) >= MAX_FOLLOW_UPS_PER_HOUR) continue;

      // Check deduplication
      const { data: lastHeartbeat } = await supabase
        .from("moa_chat_messages")
        .select("content, created_at")
        .eq("user_id", session.userId)
        .eq("session_id", session.sessionId)
        .eq("category", "proactive")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (lastHeartbeat) {
        const lastTime = new Date(lastHeartbeat.created_at).getTime();
        if (Date.now() - lastTime < DEDUP_WINDOW_MS) continue;
      }

      result.processed++;

      try {
        // Generate proactive follow-up
        const followUpPrompt = buildProactiveFollowUpPrompt(
          session.lastUserMsg,
          session.lastAssistantMsg,
        );

        const aiResult = await generateAIResponse({
          message: followUpPrompt,
          userId: session.userId,
          sessionId: session.sessionId,
          channel: session.channel,
          category: "proactive",
        });

        const cleanReply = stripHeartbeatToken(aiResult.reply);

        if (cleanReply) {
          await supabase.from("moa_chat_messages").insert({
            user_id: session.userId,
            session_id: session.sessionId,
            role: "assistant",
            content: cleanReply,
            channel: session.channel,
            model_used: `heartbeat/${aiResult.model}`,
            category: "proactive",
          });
          result.delivered++;
        } else {
          result.skipped++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Proactive follow-up for ${session.userId}: ${msg}`);
      }
    }
  } catch (err) {
    result.errors.push(`processProactiveFollowUps: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ────────────────────────────────────────────
// Prompts for Heartbeat
// ────────────────────────────────────────────

function buildTaskCompletionPrompt(task: PendingTask): string {
  return `[SYSTEM: HEARTBEAT — Task Completed]
You previously told the user you would work on something. That task is now complete.

Task: ${task.description}
Result: ${task.result ?? "작업이 완료되었습니다."}
Original context: ${task.context.slice(0, 500)}

Please relay the completion naturally to the user in Korean. Be brief and helpful.
If there's nothing else to report, respond with just: HEARTBEAT_OK
If the task completed successfully, let the user know and ask if they need anything else.
Do NOT include the HEARTBEAT_OK token if you have meaningful content to share.`;
}

function buildProactiveFollowUpPrompt(
  lastUserMsg: string,
  lastAssistantMsg: string,
): string {
  return `[SYSTEM: HEARTBEAT — Proactive Follow-up]
Review the last exchange and determine if a follow-up is needed.

Last user message: "${lastUserMsg.slice(0, 300)}"
Your last response: "${lastAssistantMsg.slice(0, 300)}"

If your last response indicated you would do something (record, process, create, etc.),
provide a brief follow-up confirming completion and asking what the user needs next.

If your last response was a complete answer with nothing pending,
respond with just: HEARTBEAT_OK

Keep follow-ups natural, brief, and in the same language as the conversation.
Example good follow-ups:
- "요청하신 내용을 처리했습니다. 다른 도움이 필요하신가요?"
- "기록이 완료되었어요. 추가로 도와드릴 것이 있을까요?"

Do NOT follow up just to repeat what you already said.`;
}

/**
 * Detect if an assistant message indicates pending/incomplete work.
 * These patterns suggest the agent promised to do something async.
 */
function detectPendingWork(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns = [
    /잠시만|기다려|처리.*중|확인.*중|작업.*중/,
    /해드리겠|해볼게|찾아볼게|알아볼게|정리.*해/,
    /기록.*하겠|저장.*하겠|준비.*하겠/,
    /please wait|working on|processing|let me/i,
    /i'll.*check|i'll.*look|i'll.*prepare/i,
  ];

  return patterns.some((p) => p.test(lower));
}
