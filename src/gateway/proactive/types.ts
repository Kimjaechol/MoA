/**
 * MoA Proactive Agent System — Core Types
 *
 * Enables agents to act autonomously via the gateway:
 *   - Trigger Engine: state changes → gateway actions
 *   - Agent Journal: agents read their "diary" before acting
 *   - Agent Bridge: inter-agent messages treated like user commands
 *   - Autonomy Manager: orchestrates heartbeat, cron, triggers, and A2A
 *
 * Architecture follows OpenClaw's gateway-centric model:
 *   heartbeat/cron/state-change → gateway → tag + enqueue → agent processes
 */

// ─── Trigger Types ───

/** Sources that can wake an agent */
export type TriggerSource =
  | "heartbeat" // periodic heartbeat (default 30m)
  | "cron" // scheduled cron job
  | "state_change" // internal state mutation (e.g. server down)
  | "agent_message" // another agent sent a message
  | "system_alarm" // system-level alert (e.g. resource threshold)
  | "webhook" // external webhook event
  | "journal_directive"; // directive found in agent's journal

/** Priority levels for trigger processing */
export type TriggerPriority = "critical" | "high" | "normal" | "low";

/** A trigger event that enters the gateway queue */
export interface TriggerEvent {
  id: string;
  source: TriggerSource;
  priority: TriggerPriority;
  /** Target agent session key */
  targetSessionKey: string;
  /** Human-readable description of the trigger */
  description: string;
  /** Structured payload for the agent */
  payload: TriggerPayload;
  /** Tags for filtering and routing */
  tags: string[];
  /** When this trigger was created */
  createdAtMs: number;
  /** Optional expiry — triggers older than this are dropped */
  expiresAtMs?: number;
  /** Whether this trigger has been processed */
  processed: boolean;
  /** Processing result */
  result?: TriggerResult;
}

/** Payload carried by a trigger */
export interface TriggerPayload {
  /** The message/prompt to inject into the agent session */
  message: string;
  /** Additional context for the agent */
  context?: Record<string, unknown>;
  /** Source agent session key (for A2A triggers) */
  sourceAgentKey?: string;
  /** Action hint — what the agent should consider doing */
  actionHint?: string;
  /** Related memory chunk IDs for context */
  relatedMemoryIds?: string[];
}

/** Result of processing a trigger */
export interface TriggerResult {
  status: "executed" | "skipped" | "failed" | "deferred";
  reason?: string;
  responseText?: string;
  actionsPerformed?: string[];
  durationMs?: number;
}

// ─── Trigger Rules ───

/** Condition that determines when a trigger fires */
export interface TriggerCondition {
  /** What kind of state to monitor */
  type: "metric_threshold" | "event_match" | "schedule" | "pattern";
  /** For metric_threshold: the metric to watch */
  metric?: string;
  /** For metric_threshold: the threshold value */
  threshold?: number;
  /** For metric_threshold: comparison operator */
  operator?: "gt" | "lt" | "eq" | "gte" | "lte";
  /** For event_match: event name pattern (regex) */
  eventPattern?: string;
  /** For schedule: cron expression */
  cronExpr?: string;
  /** For pattern: text pattern to match in logs/events */
  textPattern?: string;
}

/** A rule that defines when and how to create triggers */
export interface TriggerRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** Conditions that must be met (AND logic) */
  conditions: TriggerCondition[];
  /** Action to perform when conditions match */
  action: TriggerAction;
  /** Cooldown to prevent trigger spam (ms) */
  cooldownMs: number;
  /** Last time this rule fired */
  lastFiredAtMs?: number;
  /** Tags applied to generated triggers */
  tags: string[];
  /** Priority of generated triggers */
  priority: TriggerPriority;
}

/** Action to perform when a trigger rule matches */
export interface TriggerAction {
  /** Type of action */
  type: "agent_prompt" | "agent_to_agent" | "system_event" | "channel_message";
  /** Target agent session key */
  targetSessionKey: string;
  /** Message template (supports {{variable}} placeholders) */
  messageTemplate: string;
  /** For agent_to_agent: the source agent */
  sourceAgentKey?: string;
  /** For channel_message: channel and recipient */
  channel?: string;
  to?: string;
}

// ─── Agent Journal Types ───

/** An entry in the agent's journal (diary) */
export interface JournalEntry {
  id: string;
  agentId: string;
  /** When the entry was written */
  timestamp: number;
  /** Content of the journal entry */
  content: string;
  /** Tags for this entry */
  tags: string[];
  /** Type of entry */
  type: JournalEntryType;
  /** Priority — high priority items are always read before acting */
  priority: TriggerPriority;
  /** Whether this entry is still active (unresolved) */
  active: boolean;
  /** Optional expiry timestamp */
  expiresAtMs?: number;
  /** Related trigger rule IDs */
  relatedRuleIds?: string[];
}

export type JournalEntryType =
  | "directive" // standing order (e.g. "call developer if server down")
  | "observation" // something the agent noticed
  | "plan" // planned future action
  | "reflection" // agent's self-assessment
  | "reminder" // time-based reminder
  | "learning"; // lesson learned from past action

// ─── Agent Bridge Types ───

/** Inter-agent message routed through the gateway */
export interface AgentBridgeMessage {
  id: string;
  /** Source agent session key */
  fromAgent: string;
  /** Target agent session key */
  toAgent: string;
  /** Message content */
  message: string;
  /** Tags for routing and filtering */
  tags: string[];
  /** Priority */
  priority: TriggerPriority;
  /** Whether this message should be treated as a user command */
  treatAsUserCommand: boolean;
  /** Timestamp */
  createdAtMs: number;
  /** Optional: expected response format */
  expectResponse?: boolean;
  /** Optional: max turns for ping-pong */
  maxTurns?: number;
}

/** Response from an agent bridge message */
export interface AgentBridgeResponse {
  messageId: string;
  fromAgent: string;
  toAgent: string;
  response: string;
  tags: string[];
  respondedAtMs: number;
}

// ─── Autonomy Manager Types ───

/** State of the autonomy manager */
export interface AutonomyState {
  /** Whether autonomous behavior is enabled */
  enabled: boolean;
  /** Active trigger rules */
  activeRules: number;
  /** Pending triggers in queue */
  pendingTriggers: number;
  /** Triggers processed in last hour */
  processedLastHour: number;
  /** Active agent journal directives */
  activeDirectives: number;
  /** Pending A2A messages */
  pendingBridgeMessages: number;
  /** System health metrics */
  metrics: Record<string, number>;
  /** Last heartbeat timestamp */
  lastHeartbeatMs: number;
  /** Last autonomous action timestamp */
  lastAutonomousActionMs: number;
}

/** Configuration for the autonomy manager */
export interface AutonomyConfig {
  /** Master switch for autonomous behavior */
  enabled: boolean;
  /** Max triggers to process per heartbeat cycle */
  maxTriggersPerCycle: number;
  /** Max concurrent agent runs */
  maxConcurrentAgentRuns: number;
  /** Default trigger cooldown (ms) */
  defaultCooldownMs: number;
  /** Whether agents can send messages to other agents unprompted */
  allowUnpromptedA2A: boolean;
  /** Whether agents can send messages to channels unprompted */
  allowUnpromptedChannelMessages: boolean;
  /** Max journal entries to read before each action */
  maxJournalEntriesPerAction: number;
  /** Active hours (agent only acts during these hours) */
  activeHours?: {
    start: string; // "HH:MM"
    end: string; // "HH:MM"
    timezone?: string;
  };
}

// ─── Enhanced Memory Tag Types ───

/** Tags that carry proactive behavior metadata */
export interface ProactiveMemoryTag {
  /** Tag name */
  name: string;
  /** Category of the tag */
  category: "trigger" | "action" | "context" | "agent" | "priority" | "expiry";
  /** The actual value */
  value: string;
  /** For trigger tags: the condition that activates this memory */
  triggerCondition?: TriggerCondition;
  /** For action tags: what to do when the memory is relevant */
  actionHint?: string;
  /** For agent tags: which agent(s) this memory belongs to */
  agentIds?: string[];
  /** For priority tags: the priority level */
  priority?: TriggerPriority;
  /** For expiry tags: when this tag expires */
  expiresAtMs?: number;
}
