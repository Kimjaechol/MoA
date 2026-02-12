/**
 * MoA Proactive Agent System — Trigger Engine
 *
 * The Trigger Engine monitors state changes, metrics, and events,
 * then creates TriggerEvents that enter the gateway queue.
 *
 * This is the core mechanism that allows agents to act proactively:
 *   - System alarm → gateway detects server down → trigger fires
 *   - Metric threshold → CPU > 90% → agent notified
 *   - Event pattern → "error" in logs → agent investigates
 *   - Schedule → cron-like periodic checks
 *
 * All triggers flow through the gateway and are processed like
 * human commands, giving agents the same capabilities as if
 * a human had issued the instruction.
 */

import type {
  TriggerEvent,
  TriggerRule,
  TriggerCondition,
  TriggerResult,
  TriggerPriority,
  TriggerPayload,
} from "./types.js";

// ─── Trigger Queue ───

const MAX_QUEUE_SIZE = 200;
const MAX_PROCESSED_LOG = 500;

/** In-memory trigger queue, ordered by priority then timestamp */
let triggerQueue: TriggerEvent[] = [];
/** Log of recently processed triggers */
let processedLog: TriggerEvent[] = [];
/** Registered trigger rules */
const rules = new Map<string, TriggerRule>();
/** Listeners for trigger events */
const listeners = new Set<(event: TriggerEvent) => void>();
/** Metrics store for threshold-based triggers */
const metrics = new Map<string, number>();

// ─── Queue Management ───

let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `trg_${Date.now()}_${idCounter}`;
}

/**
 * Enqueue a new trigger event. The gateway processes these
 * in priority order during each heartbeat cycle.
 */
export function enqueueTrigger(params: {
  source: TriggerEvent["source"];
  priority: TriggerPriority;
  targetSessionKey: string;
  description: string;
  payload: TriggerPayload;
  tags?: string[];
  expiresAtMs?: number;
}): TriggerEvent {
  const event: TriggerEvent = {
    id: generateId(),
    source: params.source,
    priority: params.priority,
    targetSessionKey: params.targetSessionKey,
    description: params.description,
    payload: params.payload,
    tags: params.tags ?? [],
    createdAtMs: Date.now(),
    expiresAtMs: params.expiresAtMs,
    processed: false,
  };

  triggerQueue.push(event);
  sortQueue();

  // Enforce max queue size — drop lowest priority items
  if (triggerQueue.length > MAX_QUEUE_SIZE) {
    triggerQueue = triggerQueue.slice(0, MAX_QUEUE_SIZE);
  }

  // Notify listeners
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // ignore listener errors
    }
  }

  return event;
}

/** Sort queue: critical > high > normal > low, then by timestamp */
function sortQueue(): void {
  const priorityOrder: Record<TriggerPriority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };

  triggerQueue.sort((a, b) => {
    const pa = priorityOrder[a.priority];
    const pb = priorityOrder[b.priority];
    if (pa !== pb) {
      return pa - pb;
    }
    return a.createdAtMs - b.createdAtMs;
  });
}

/**
 * Drain up to `limit` triggers from the queue for processing.
 * Expired triggers are automatically discarded.
 */
export function drainTriggers(limit: number = 10): TriggerEvent[] {
  const now = Date.now();

  // Remove expired triggers
  triggerQueue = triggerQueue.filter((t) => !t.expiresAtMs || t.expiresAtMs > now);

  const batch = triggerQueue.splice(0, limit);
  return batch;
}

/**
 * Mark a trigger as processed and move it to the log.
 */
export function completeTrigger(id: string, result: TriggerResult): void {
  const idx = triggerQueue.findIndex((t) => t.id === id);
  if (idx >= 0) {
    const trigger = triggerQueue.splice(idx, 1)[0];
    trigger.processed = true;
    trigger.result = result;
    processedLog.push(trigger);
  } else {
    // Already drained — find in un-logged processed items
    // This is a no-op if the trigger was already moved
  }

  // Trim processed log
  if (processedLog.length > MAX_PROCESSED_LOG) {
    processedLog = processedLog.slice(-MAX_PROCESSED_LOG);
  }
}

/** Get the current queue snapshot (read-only) */
export function peekTriggerQueue(): readonly TriggerEvent[] {
  return triggerQueue;
}

/** Get recently processed triggers */
export function getProcessedTriggers(limit: number = 50): readonly TriggerEvent[] {
  return processedLog.slice(-limit);
}

/** Get queue stats */
export function getTriggerQueueStats(): {
  pending: number;
  byCritical: number;
  byHigh: number;
  byNormal: number;
  byLow: number;
  processedTotal: number;
} {
  return {
    pending: triggerQueue.length,
    byCritical: triggerQueue.filter((t) => t.priority === "critical").length,
    byHigh: triggerQueue.filter((t) => t.priority === "high").length,
    byNormal: triggerQueue.filter((t) => t.priority === "normal").length,
    byLow: triggerQueue.filter((t) => t.priority === "low").length,
    processedTotal: processedLog.length,
  };
}

// ─── Trigger Rules ───

/** Register a trigger rule */
export function registerTriggerRule(rule: TriggerRule): void {
  rules.set(rule.id, rule);
}

/** Remove a trigger rule */
export function removeTriggerRule(ruleId: string): boolean {
  return rules.delete(ruleId);
}

/** Get all registered rules */
export function getTriggerRules(): TriggerRule[] {
  return [...rules.values()];
}

/** Get a specific rule */
export function getTriggerRule(ruleId: string): TriggerRule | undefined {
  return rules.get(ruleId);
}

/** Update a trigger rule */
export function updateTriggerRule(ruleId: string, patch: Partial<TriggerRule>): boolean {
  const existing = rules.get(ruleId);
  if (!existing) {
    return false;
  }
  rules.set(ruleId, { ...existing, ...patch, id: ruleId });
  return true;
}

// ─── Rule Evaluation ───

/**
 * Evaluate all active trigger rules against current state.
 * This is called on every heartbeat cycle and after state changes.
 *
 * When a rule's conditions are met and cooldown has passed,
 * a new trigger is created and enqueued.
 */
export function evaluateRules(context?: {
  eventName?: string;
  eventText?: string;
  metrics?: Record<string, number>;
}): TriggerEvent[] {
  const now = Date.now();
  const created: TriggerEvent[] = [];

  // Update metrics if provided
  if (context?.metrics) {
    for (const [key, value] of Object.entries(context.metrics)) {
      metrics.set(key, value);
    }
  }

  for (const rule of rules.values()) {
    if (!rule.enabled) {
      continue;
    }

    // Check cooldown
    if (rule.lastFiredAtMs && now - rule.lastFiredAtMs < rule.cooldownMs) {
      continue;
    }

    // Evaluate all conditions (AND logic)
    const allMet = rule.conditions.every((cond) => evaluateCondition(cond, context));

    if (allMet) {
      // Build message from template
      const message = resolveTemplate(rule.action.messageTemplate, {
        ruleName: rule.name,
        ruleDescription: rule.description ?? "",
        eventName: context?.eventName ?? "",
        eventText: context?.eventText ?? "",
        timestamp: new Date().toISOString(),
        ...Object.fromEntries(metrics.entries()),
      });

      const trigger = enqueueTrigger({
        source: "state_change",
        priority: rule.priority,
        targetSessionKey: rule.action.targetSessionKey,
        description: `Rule "${rule.name}" triggered`,
        payload: {
          message,
          context: {
            ruleId: rule.id,
            ruleName: rule.name,
            ...context,
          },
          sourceAgentKey: rule.action.sourceAgentKey,
          actionHint: rule.action.type,
        },
        tags: [...rule.tags],
      });

      // Update last fired timestamp
      rule.lastFiredAtMs = now;
      created.push(trigger);
    }
  }

  return created;
}

/** Evaluate a single trigger condition */
function evaluateCondition(
  condition: TriggerCondition,
  context?: {
    eventName?: string;
    eventText?: string;
    metrics?: Record<string, number>;
  },
): boolean {
  switch (condition.type) {
    case "metric_threshold": {
      if (!condition.metric || condition.threshold == null) {
        return false;
      }
      const value = context?.metrics?.[condition.metric] ?? metrics.get(condition.metric);
      if (value == null) {
        return false;
      }
      return compareValues(value, condition.threshold, condition.operator ?? "gt");
    }

    case "event_match": {
      if (!condition.eventPattern) {
        return false;
      }
      const name = context?.eventName ?? "";
      try {
        return new RegExp(condition.eventPattern).test(name);
      } catch {
        return false;
      }
    }

    case "pattern": {
      if (!condition.textPattern) {
        return false;
      }
      const text = context?.eventText ?? "";
      try {
        return new RegExp(condition.textPattern, "i").test(text);
      } catch {
        return text.toLowerCase().includes(condition.textPattern.toLowerCase());
      }
    }

    case "schedule": {
      // Schedule conditions are handled by the cron system, not inline evaluation
      return false;
    }
  }
}

function compareValues(actual: number, threshold: number, operator: string): boolean {
  switch (operator) {
    case "gt":
      return actual > threshold;
    case "lt":
      return actual < threshold;
    case "eq":
      return actual === threshold;
    case "gte":
      return actual >= threshold;
    case "lte":
      return actual <= threshold;
    default:
      return false;
  }
}

/** Resolve {{variable}} placeholders in a template string */
function resolveTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val != null ? String(val) : `{{${key}}}`;
  });
}

// ─── Metrics ───

/** Update a metric value (used by system monitors) */
export function updateMetric(name: string, value: number): void {
  metrics.set(name, value);
}

/** Get current metric value */
export function getMetric(name: string): number | undefined {
  return metrics.get(name);
}

/** Get all metrics */
export function getAllMetrics(): Record<string, number> {
  return Object.fromEntries(metrics.entries());
}

// ─── Event Listeners ───

/** Subscribe to trigger events */
export function onTriggerEvent(listener: (event: TriggerEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ─── Reset (for testing) ───

export function resetTriggerEngineForTest(): void {
  triggerQueue = [];
  processedLog = [];
  rules.clear();
  listeners.clear();
  metrics.clear();
  idCounter = 0;
}
