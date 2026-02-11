/**
 * MoA Proactive Agent System — Autonomy Manager
 *
 * The Autonomy Manager is the top-level orchestrator that ties together:
 *   - Trigger Engine (state changes → triggers)
 *   - Agent Journal (standing orders, learnings)
 *   - Agent Bridge (A2A communication)
 *   - Heartbeat (periodic check-ins)
 *   - Cron (scheduled tasks)
 *   - System Events (ephemeral notifications)
 *
 * On each heartbeat cycle, the Autonomy Manager:
 *   1. Evaluates trigger rules against current state
 *   2. Drains the trigger queue
 *   3. For each trigger, reads the agent's journal
 *   4. Processes A2A messages
 *   5. Builds the final prompt with all context
 *   6. Enqueues the work as a system event or agent turn
 *
 * This is what makes the agent "self-driving":
 *   - The owner sleeps, but heartbeat keeps firing
 *   - System alarms create triggers
 *   - Triggers reference journal directives
 *   - The agent acts as if the owner gave the command
 *   - Other agents can delegate work through the bridge
 */

import type { AutonomyConfig, AutonomyState, TriggerEvent } from "./types.js";
import { drainMessagesForAgent, getBridgeStats } from "./agent-bridge.js";
import { buildJournalPrompt, hasUrgentDirectives, getJournalStats } from "./agent-journal.js";
import {
  drainTriggers,
  completeTrigger,
  evaluateRules,
  getTriggerQueueStats,
  getAllMetrics,
} from "./trigger-engine.js";

// ─── Default Configuration ───

const DEFAULT_CONFIG: AutonomyConfig = {
  enabled: true,
  maxTriggersPerCycle: 5,
  maxConcurrentAgentRuns: 3,
  defaultCooldownMs: 60_000, // 1 minute
  allowUnpromptedA2A: true,
  allowUnpromptedChannelMessages: false,
  maxJournalEntriesPerAction: 10,
};

// ─── Manager State ───

let config: AutonomyConfig = { ...DEFAULT_CONFIG };
let lastHeartbeatMs = 0;
let lastAutonomousActionMs = 0;
let processedLastHour = 0;
let processedLastHourResetMs = Date.now();
let cycleRunning = false;

/** Callback to enqueue a system event into the gateway's main session */
type SystemEventCallback = (sessionKey: string, text: string) => void;
let systemEventCallback: SystemEventCallback | null = null;

/** Callback to run an agent turn (isolated or main) */
type AgentTurnCallback = (params: {
  sessionKey: string;
  message: string;
  extraSystemPrompt?: string;
}) => Promise<string | null>;
let agentTurnCallback: AgentTurnCallback | null = null;

// ─── Configuration ───

/** Update autonomy configuration */
export function setAutonomyConfig(patch: Partial<AutonomyConfig>): void {
  config = { ...config, ...patch };
}

/** Get current autonomy configuration */
export function getAutonomyConfig(): AutonomyConfig {
  return { ...config };
}

/** Set the callback for enqueueing system events */
export function setSystemEventCallback(cb: SystemEventCallback): void {
  systemEventCallback = cb;
}

/** Set the callback for running agent turns */
export function setAgentTurnCallback(cb: AgentTurnCallback): void {
  agentTurnCallback = cb;
}

// ─── Main Autonomy Cycle ───

/**
 * Run a single autonomy cycle. Called on each heartbeat.
 *
 * This is the "brain" of the autonomous agent system:
 *   1. Evaluate rules → create new triggers
 *   2. Drain trigger queue → get work items
 *   3. For each trigger, build context with journal
 *   4. Process A2A bridge messages
 *   5. Execute actions via callbacks
 */
export async function runAutonomyCycle(context?: {
  sessionKey?: string;
  metrics?: Record<string, number>;
  eventName?: string;
  eventText?: string;
}): Promise<{
  triggersProcessed: number;
  a2aProcessed: number;
  skipped: number;
  errors: string[];
}> {
  if (!config.enabled) {
    return { triggersProcessed: 0, a2aProcessed: 0, skipped: 0, errors: [] };
  }

  if (cycleRunning) {
    return {
      triggersProcessed: 0,
      a2aProcessed: 0,
      skipped: 0,
      errors: ["cycle already running"],
    };
  }

  cycleRunning = true;
  lastHeartbeatMs = Date.now();

  // Reset hourly counter if needed
  if (Date.now() - processedLastHourResetMs > 3_600_000) {
    processedLastHour = 0;
    processedLastHourResetMs = Date.now();
  }

  const result = {
    triggersProcessed: 0,
    a2aProcessed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    // Step 1: Evaluate trigger rules against current state
    evaluateRules({
      eventName: context?.eventName,
      eventText: context?.eventText,
      metrics: context?.metrics,
    });

    // Step 2: Drain trigger queue
    const triggers = drainTriggers(config.maxTriggersPerCycle);

    // Step 3: Process each trigger with journal context
    for (const trigger of triggers) {
      try {
        await processTrigger(trigger, context?.sessionKey);
        result.triggersProcessed += 1;
        processedLastHour += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`Trigger ${trigger.id}: ${message}`);
        completeTrigger(trigger.id, {
          status: "failed",
          reason: message,
        });
      }
    }

    // Step 4: Process A2A bridge messages
    if (config.allowUnpromptedA2A && context?.sessionKey) {
      const a2aMessages = drainMessagesForAgent(context.sessionKey, config.maxTriggersPerCycle);

      for (const msg of a2aMessages) {
        try {
          await processA2AMessage(msg, context.sessionKey);
          result.a2aProcessed += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push(`A2A ${msg.id}: ${message}`);
        }
      }
    }

    lastAutonomousActionMs =
      result.triggersProcessed > 0 || result.a2aProcessed > 0 ? Date.now() : lastAutonomousActionMs;
  } finally {
    cycleRunning = false;
  }

  return result;
}

/**
 * Process a single trigger event.
 *
 * 1. Read the agent's journal (diary) for context
 * 2. Build a composite prompt with trigger + journal
 * 3. Execute via system event or agent turn
 */
async function processTrigger(trigger: TriggerEvent, defaultSessionKey?: string): Promise<void> {
  const sessionKey = trigger.targetSessionKey || defaultSessionKey;
  if (!sessionKey) {
    completeTrigger(trigger.id, {
      status: "skipped",
      reason: "no target session key",
    });
    return;
  }

  // Extract agent ID from session key for journal lookup
  const agentId = extractAgentId(sessionKey);

  // Build journal context
  const journalPrompt = buildJournalPrompt(agentId, {
    triggerSource: `${trigger.source}: ${trigger.description}`,
    maxEntries: config.maxJournalEntriesPerAction,
  });

  // Build composite prompt
  const compositePrompt = buildCompositePrompt({
    trigger,
    journalPrompt,
    agentId,
  });

  const startMs = Date.now();

  // Execute via callback
  if (trigger.priority === "critical" || trigger.priority === "high") {
    // High-priority triggers get an agent turn (more capabilities)
    if (agentTurnCallback) {
      const response = await agentTurnCallback({
        sessionKey,
        message: trigger.payload.message,
        extraSystemPrompt: journalPrompt || undefined,
      });

      completeTrigger(trigger.id, {
        status: "executed",
        responseText: response ?? undefined,
        durationMs: Date.now() - startMs,
      });
    } else {
      // Fallback to system event
      systemEventCallback?.(sessionKey, compositePrompt);
      completeTrigger(trigger.id, {
        status: "executed",
        durationMs: Date.now() - startMs,
      });
    }
  } else {
    // Normal/low priority triggers use system events (lightweight)
    if (systemEventCallback) {
      systemEventCallback(sessionKey, compositePrompt);
      completeTrigger(trigger.id, {
        status: "executed",
        durationMs: Date.now() - startMs,
      });
    } else {
      completeTrigger(trigger.id, {
        status: "skipped",
        reason: "no system event callback configured",
      });
    }
  }
}

/**
 * Process an A2A bridge message.
 */
async function processA2AMessage(
  msg: import("./types.js").AgentBridgeMessage,
  sessionKey: string,
): Promise<void> {
  const agentId = extractAgentId(sessionKey);

  // Build journal context for the receiving agent
  const journalPrompt = buildJournalPrompt(agentId, {
    triggerSource: `agent_message from ${msg.fromAgent}`,
  });

  if (msg.treatAsUserCommand && agentTurnCallback) {
    // Treat as user command — full agent turn
    await agentTurnCallback({
      sessionKey,
      message: msg.message,
      extraSystemPrompt: journalPrompt || undefined,
    });
  } else if (systemEventCallback) {
    // Informational — inject as system event
    const text = [
      `[A2A from ${msg.fromAgent}] ${msg.message}`,
      journalPrompt ? `\n${journalPrompt}` : "",
    ].join("");

    systemEventCallback(sessionKey, text);
  }
}

/**
 * Build a composite prompt that includes trigger info and journal context.
 */
function buildCompositePrompt(params: {
  trigger: TriggerEvent;
  journalPrompt: string;
  agentId: string;
}): string {
  const { trigger, journalPrompt } = params;

  const parts: string[] = [];

  // Journal context (standing orders, learnings)
  if (journalPrompt) {
    parts.push(journalPrompt);
    parts.push("");
  }

  // Trigger context
  parts.push(`── Trigger: ${trigger.source} ──`);
  parts.push(`Priority: ${trigger.priority}`);
  parts.push(`Description: ${trigger.description}`);
  if (trigger.tags.length > 0) {
    parts.push(`Tags: ${trigger.tags.join(", ")}`);
  }
  parts.push("");
  parts.push(trigger.payload.message);

  if (trigger.payload.actionHint) {
    parts.push("");
    parts.push(`Suggested action: ${trigger.payload.actionHint}`);
  }

  return parts.join("\n");
}

/**
 * Extract agent ID from session key.
 * Session key format: "agent:<agentId>:<session-identifier>"
 */
function extractAgentId(sessionKey: string): string {
  const parts = sessionKey.split(":");
  if (parts.length >= 2 && parts[0] === "agent") {
    return parts[1];
  }
  return sessionKey;
}

// ─── State Queries ───

/**
 * Get the current state of the autonomy manager.
 */
export function getAutonomyState(): AutonomyState {
  const queueStats = getTriggerQueueStats();
  const bridgeStats = getBridgeStats();
  const allMetrics = getAllMetrics();

  return {
    enabled: config.enabled,
    activeRules: queueStats.pending,
    pendingTriggers: queueStats.pending,
    processedLastHour,
    activeDirectives: 0, // Would need to aggregate across all agents
    pendingBridgeMessages: bridgeStats.pendingMessages,
    metrics: allMetrics,
    lastHeartbeatMs,
    lastAutonomousActionMs,
  };
}

/**
 * Check if any agent has urgent work that needs immediate attention.
 */
export function hasUrgentWork(agentId: string): boolean {
  const queueStats = getTriggerQueueStats();
  return queueStats.byCritical > 0 || hasUrgentDirectives(agentId);
}

// ─── Reset (for testing) ───

export function resetAutonomyManagerForTest(): void {
  config = { ...DEFAULT_CONFIG };
  lastHeartbeatMs = 0;
  lastAutonomousActionMs = 0;
  processedLastHour = 0;
  processedLastHourResetMs = Date.now();
  cycleRunning = false;
  systemEventCallback = null;
  agentTurnCallback = null;
}
