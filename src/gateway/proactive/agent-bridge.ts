/**
 * MoA Proactive Agent System — Agent Bridge
 *
 * The Agent Bridge enables agent-to-agent (A2A) communication
 * through the gateway, treating inter-agent messages as if they
 * were user commands.
 *
 * Key principle: When agent A sends a message to agent B through
 * the bridge, the gateway processes it exactly like a human message.
 * This means agent B has full access to tools, memory, and channels.
 *
 * Use cases:
 *   - Research bot → Writer bot: "Write an article about X"
 *   - Monitor bot → DevOps bot: "Server CPU at 95%, investigate"
 *   - Scheduler bot → Any bot: "Time for your daily summary"
 *
 * The bridge also supports:
 *   - Priority-based message ordering
 *   - Tag-based routing
 *   - Response collection and forwarding
 *   - Multi-hop conversations (ping-pong turns)
 */

import type { AgentBridgeMessage, AgentBridgeResponse, TriggerPriority } from "./types.js";
import { enqueueTrigger } from "./trigger-engine.js";

// ─── Bridge State ───

const MAX_PENDING = 100;
const MAX_RESPONSE_LOG = 200;

/** Pending A2A messages */
let pendingMessages: AgentBridgeMessage[] = [];
/** Response log */
let responseLog: AgentBridgeResponse[] = [];
/** Message handlers for specific agent patterns */
const routeHandlers = new Map<string, (msg: AgentBridgeMessage) => Promise<string | null>>();

let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `abm_${Date.now()}_${idCounter}`;
}

// ─── Core Bridge Operations ───

/**
 * Send a message from one agent to another through the gateway.
 *
 * The message is enqueued and will be processed during the next
 * gateway cycle. If treatAsUserCommand is true (default), the
 * target agent receives it exactly as if a human had sent it.
 */
export function sendAgentMessage(params: {
  fromAgent: string;
  toAgent: string;
  message: string;
  tags?: string[];
  priority?: TriggerPriority;
  treatAsUserCommand?: boolean;
  expectResponse?: boolean;
  maxTurns?: number;
}): AgentBridgeMessage {
  const msg: AgentBridgeMessage = {
    id: generateId(),
    fromAgent: params.fromAgent,
    toAgent: params.toAgent,
    message: params.message,
    tags: params.tags ?? [],
    priority: params.priority ?? "normal",
    treatAsUserCommand: params.treatAsUserCommand ?? true,
    createdAtMs: Date.now(),
    expectResponse: params.expectResponse,
    maxTurns: params.maxTurns,
  };

  pendingMessages.push(msg);

  // Also create a trigger event so the gateway processes this
  // through the normal trigger pipeline
  enqueueTrigger({
    source: "agent_message",
    priority: msg.priority,
    targetSessionKey: msg.toAgent,
    description: `A2A message from ${msg.fromAgent}`,
    payload: {
      message: buildAgentBridgePrompt(msg),
      sourceAgentKey: msg.fromAgent,
      context: {
        bridgeMessageId: msg.id,
        fromAgent: msg.fromAgent,
        originalMessage: msg.message,
        treatAsUserCommand: msg.treatAsUserCommand,
        expectResponse: msg.expectResponse,
      },
    },
    tags: ["a2a", ...msg.tags],
  });

  // Enforce max pending
  if (pendingMessages.length > MAX_PENDING) {
    pendingMessages = pendingMessages.slice(-MAX_PENDING);
  }

  return msg;
}

/**
 * Build the prompt that wraps an A2A message.
 * When treatAsUserCommand is true, the message is presented
 * as a direct instruction to the target agent.
 */
function buildAgentBridgePrompt(msg: AgentBridgeMessage): string {
  if (msg.treatAsUserCommand) {
    // Present as if the owner sent the command
    return [
      `[Agent-to-Agent Message]`,
      `From: ${msg.fromAgent}`,
      `Priority: ${msg.priority}`,
      msg.tags.length > 0 ? `Tags: ${msg.tags.join(", ")}` : "",
      "",
      `The following message is from another agent in the system.`,
      `Process it as you would a message from the owner:`,
      "",
      msg.message,
      "",
      msg.expectResponse
        ? "Please respond — your response will be forwarded back to the sending agent."
        : "No response is expected. Take action as needed.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Informational — agent receives context but doesn't need to act
  return [`[Agent Communication - Info]`, `From: ${msg.fromAgent}`, "", msg.message].join("\n");
}

/**
 * Record a response to an A2A message.
 */
export function recordBridgeResponse(params: {
  messageId: string;
  fromAgent: string;
  toAgent: string;
  response: string;
  tags?: string[];
}): AgentBridgeResponse {
  const resp: AgentBridgeResponse = {
    messageId: params.messageId,
    fromAgent: params.fromAgent,
    toAgent: params.toAgent,
    response: params.response,
    tags: params.tags ?? [],
    respondedAtMs: Date.now(),
  };

  responseLog.push(resp);

  // Remove from pending
  pendingMessages = pendingMessages.filter((m) => m.id !== params.messageId);

  // Trim response log
  if (responseLog.length > MAX_RESPONSE_LOG) {
    responseLog = responseLog.slice(-MAX_RESPONSE_LOG);
  }

  return resp;
}

/**
 * Drain pending messages for a specific target agent.
 */
export function drainMessagesForAgent(toAgent: string, limit: number = 10): AgentBridgeMessage[] {
  const matching = pendingMessages.filter((m) => m.toAgent === toAgent);

  // Sort by priority then timestamp
  matching.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority];
    const pb = PRIORITY_ORDER[b.priority];
    if (pa !== pb) {
      return pa - pb;
    }
    return a.createdAtMs - b.createdAtMs;
  });

  const batch = matching.slice(0, limit);
  const batchIds = new Set(batch.map((m) => m.id));
  pendingMessages = pendingMessages.filter((m) => !batchIds.has(m.id));

  return batch;
}

/**
 * Get responses for a specific message.
 */
export function getResponsesForMessage(messageId: string): AgentBridgeResponse[] {
  return responseLog.filter((r) => r.messageId === messageId);
}

/**
 * Get all pending messages (across all agents).
 */
export function getPendingMessages(): readonly AgentBridgeMessage[] {
  return pendingMessages;
}

/**
 * Get bridge statistics.
 */
export function getBridgeStats(): {
  pendingMessages: number;
  totalResponses: number;
  messagesByPriority: Record<string, number>;
  topSenders: Array<{ agent: string; count: number }>;
  topReceivers: Array<{ agent: string; count: number }>;
} {
  const messagesByPriority: Record<string, number> = {};
  const senderCounts = new Map<string, number>();
  const receiverCounts = new Map<string, number>();

  for (const msg of pendingMessages) {
    messagesByPriority[msg.priority] = (messagesByPriority[msg.priority] ?? 0) + 1;
    senderCounts.set(msg.fromAgent, (senderCounts.get(msg.fromAgent) ?? 0) + 1);
    receiverCounts.set(msg.toAgent, (receiverCounts.get(msg.toAgent) ?? 0) + 1);
  }

  const topSenders = [...senderCounts.entries()]
    .map(([agent, count]) => ({ agent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const topReceivers = [...receiverCounts.entries()]
    .map(([agent, count]) => ({ agent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    pendingMessages: pendingMessages.length,
    totalResponses: responseLog.length,
    messagesByPriority,
    topSenders,
    topReceivers,
  };
}

// ─── Route Handlers ───

/**
 * Register a handler for messages matching a specific agent pattern.
 * This allows custom processing logic for specific agent-to-agent routes.
 */
export function registerRouteHandler(
  pattern: string,
  handler: (msg: AgentBridgeMessage) => Promise<string | null>,
): void {
  routeHandlers.set(pattern, handler);
}

/**
 * Find and invoke a route handler for a message.
 * Returns the handler's response, or null if no handler matches.
 */
export async function invokeRouteHandler(msg: AgentBridgeMessage): Promise<string | null> {
  // Try exact match first
  const exactHandler = routeHandlers.get(msg.toAgent);
  if (exactHandler) {
    return exactHandler(msg);
  }

  // Try pattern match
  for (const [pattern, handler] of routeHandlers) {
    try {
      if (new RegExp(pattern).test(msg.toAgent)) {
        return handler(msg);
      }
    } catch {
      // invalid regex, skip
    }
  }

  return null;
}

// ─── Helpers ───

const PRIORITY_ORDER: Record<TriggerPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ─── Reset (for testing) ───

export function resetBridgeForTest(): void {
  pendingMessages = [];
  responseLog = [];
  routeHandlers.clear();
  idCounter = 0;
}
