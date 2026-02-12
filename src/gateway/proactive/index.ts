/**
 * MoA Proactive Agent System — Public Exports
 *
 * Gateway-centric autonomous agent architecture:
 *   - Trigger Engine: state changes → triggers → agent actions
 *   - Agent Journal: agents read their "diary" before acting
 *   - Agent Bridge: inter-agent messages treated like user commands
 *   - Autonomy Manager: orchestrates heartbeat, cron, triggers, A2A
 *
 * How it works (simplified):
 *   heartbeat/cron fires → autonomy manager wakes →
 *   evaluates trigger rules → reads agent journal →
 *   processes A2A messages → builds composite prompt →
 *   gateway enqueues as system event or agent turn →
 *   agent processes with full tool/memory access
 */

// ─── Types ───
export type {
  TriggerSource,
  TriggerPriority,
  TriggerEvent,
  TriggerPayload,
  TriggerResult,
  TriggerCondition,
  TriggerRule,
  TriggerAction,
  JournalEntry,
  JournalEntryType,
  AgentBridgeMessage,
  AgentBridgeResponse,
  AutonomyState,
  AutonomyConfig,
  ProactiveMemoryTag,
} from "./types.js";

// ─── Trigger Engine ───
export {
  enqueueTrigger,
  drainTriggers,
  completeTrigger,
  peekTriggerQueue,
  getProcessedTriggers,
  getTriggerQueueStats,
  registerTriggerRule,
  removeTriggerRule,
  getTriggerRules,
  getTriggerRule,
  updateTriggerRule,
  evaluateRules,
  updateMetric,
  getMetric,
  getAllMetrics,
  onTriggerEvent,
} from "./trigger-engine.js";

// ─── Agent Journal ───
export {
  addJournalEntry,
  getActiveJournalEntries,
  buildJournalPrompt,
  deactivateJournalEntry,
  getAllJournalEntries,
  getJournalStats,
  hasUrgentDirectives,
  serializeJournalToMarkdown,
} from "./agent-journal.js";

// ─── Agent Bridge (A2A) ───
export {
  sendAgentMessage,
  recordBridgeResponse,
  drainMessagesForAgent,
  getResponsesForMessage,
  getPendingMessages,
  getBridgeStats,
  registerRouteHandler,
  invokeRouteHandler,
} from "./agent-bridge.js";

// ─── Autonomy Manager ───
export {
  setAutonomyConfig,
  getAutonomyConfig,
  setSystemEventCallback,
  setAgentTurnCallback,
  runAutonomyCycle,
  getAutonomyState,
  hasUrgentWork,
} from "./autonomy-manager.js";
