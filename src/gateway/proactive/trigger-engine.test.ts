import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueueTrigger,
  drainTriggers,
  completeTrigger,
  peekTriggerQueue,
  getProcessedTriggers,
  getTriggerQueueStats,
  registerTriggerRule,
  removeTriggerRule,
  getTriggerRules,
  evaluateRules,
  updateMetric,
  getMetric,
  getAllMetrics,
  onTriggerEvent,
  resetTriggerEngineForTest,
} from "./trigger-engine.js";

beforeEach(() => {
  resetTriggerEngineForTest();
});

describe("Trigger Queue", () => {
  it("enqueues and drains triggers in priority order", () => {
    enqueueTrigger({
      source: "heartbeat",
      priority: "low",
      targetSessionKey: "agent:main:main",
      description: "Low priority check",
      payload: { message: "low" },
    });

    enqueueTrigger({
      source: "system_alarm",
      priority: "critical",
      targetSessionKey: "agent:main:main",
      description: "Server down",
      payload: { message: "critical alert" },
    });

    enqueueTrigger({
      source: "cron",
      priority: "normal",
      targetSessionKey: "agent:main:main",
      description: "Scheduled check",
      payload: { message: "normal" },
    });

    const drained = drainTriggers(10);
    expect(drained).toHaveLength(3);
    expect(drained[0].priority).toBe("critical");
    expect(drained[1].priority).toBe("normal");
    expect(drained[2].priority).toBe("low");
  });

  it("respects drain limit", () => {
    for (let i = 0; i < 10; i++) {
      enqueueTrigger({
        source: "heartbeat",
        priority: "normal",
        targetSessionKey: "agent:main:main",
        description: `Check ${i}`,
        payload: { message: `msg ${i}` },
      });
    }

    const drained = drainTriggers(3);
    expect(drained).toHaveLength(3);
    expect(peekTriggerQueue()).toHaveLength(7);
  });

  it("drops expired triggers on drain", () => {
    enqueueTrigger({
      source: "heartbeat",
      priority: "normal",
      targetSessionKey: "agent:main:main",
      description: "Expired",
      payload: { message: "old" },
      expiresAtMs: Date.now() - 1000, // already expired
    });

    enqueueTrigger({
      source: "heartbeat",
      priority: "normal",
      targetSessionKey: "agent:main:main",
      description: "Fresh",
      payload: { message: "new" },
    });

    const drained = drainTriggers(10);
    expect(drained).toHaveLength(1);
    expect(drained[0].description).toBe("Fresh");
  });

  it("completes triggers and moves to processed log", () => {
    const trigger = enqueueTrigger({
      source: "state_change",
      priority: "high",
      targetSessionKey: "agent:main:main",
      description: "State changed",
      payload: { message: "check" },
    });

    completeTrigger(trigger.id, {
      status: "executed",
      responseText: "done",
      durationMs: 100,
    });

    expect(peekTriggerQueue()).toHaveLength(0);
    const processed = getProcessedTriggers();
    expect(processed).toHaveLength(1);
    expect(processed[0].result?.status).toBe("executed");
  });

  it("provides accurate queue stats", () => {
    enqueueTrigger({
      source: "system_alarm",
      priority: "critical",
      targetSessionKey: "agent:main:main",
      description: "Alert",
      payload: { message: "!" },
    });
    enqueueTrigger({
      source: "heartbeat",
      priority: "high",
      targetSessionKey: "agent:main:main",
      description: "Check",
      payload: { message: "?" },
    });
    enqueueTrigger({
      source: "cron",
      priority: "normal",
      targetSessionKey: "agent:main:main",
      description: "Scheduled",
      payload: { message: "." },
    });

    const stats = getTriggerQueueStats();
    expect(stats.pending).toBe(3);
    expect(stats.byCritical).toBe(1);
    expect(stats.byHigh).toBe(1);
    expect(stats.byNormal).toBe(1);
    expect(stats.byLow).toBe(0);
  });

  it("fires event listeners on enqueue", () => {
    const events: string[] = [];
    const unsub = onTriggerEvent((evt) => events.push(evt.description));

    enqueueTrigger({
      source: "heartbeat",
      priority: "normal",
      targetSessionKey: "agent:main:main",
      description: "Test event",
      payload: { message: "test" },
    });

    expect(events).toEqual(["Test event"]);

    unsub();
    enqueueTrigger({
      source: "heartbeat",
      priority: "normal",
      targetSessionKey: "agent:main:main",
      description: "After unsub",
      payload: { message: "test" },
    });

    expect(events).toHaveLength(1); // listener was removed
  });
});

describe("Trigger Rules", () => {
  it("registers, retrieves, and removes rules", () => {
    registerTriggerRule({
      id: "rule-1",
      name: "CPU Alert",
      enabled: true,
      conditions: [{ type: "metric_threshold", metric: "cpu", threshold: 90, operator: "gt" }],
      action: {
        type: "agent_prompt",
        targetSessionKey: "agent:devops:main",
        messageTemplate: "CPU is at {{cpu}}%, investigate.",
      },
      cooldownMs: 60_000,
      tags: ["monitoring"],
      priority: "high",
    });

    expect(getTriggerRules()).toHaveLength(1);
    expect(removeTriggerRule("rule-1")).toBe(true);
    expect(getTriggerRules()).toHaveLength(0);
  });

  it("evaluates metric_threshold conditions", () => {
    registerTriggerRule({
      id: "rule-cpu",
      name: "CPU High",
      enabled: true,
      conditions: [{ type: "metric_threshold", metric: "cpu", threshold: 90, operator: "gt" }],
      action: {
        type: "agent_prompt",
        targetSessionKey: "agent:devops:main",
        messageTemplate: "CPU at {{cpu}}%.",
      },
      cooldownMs: 0, // no cooldown for test
      tags: ["cpu"],
      priority: "critical",
    });

    // CPU below threshold — no trigger
    const noTriggers = evaluateRules({
      metrics: { cpu: 50 },
    });
    expect(noTriggers).toHaveLength(0);

    // CPU above threshold — trigger fires
    const triggers = evaluateRules({
      metrics: { cpu: 95 },
    });
    expect(triggers).toHaveLength(1);
    expect(triggers[0].priority).toBe("critical");
    expect(triggers[0].payload.message).toBe("CPU at 95%.");
  });

  it("evaluates event_match conditions", () => {
    registerTriggerRule({
      id: "rule-error",
      name: "Error Detector",
      enabled: true,
      conditions: [{ type: "event_match", eventPattern: "error|failure" }],
      action: {
        type: "agent_prompt",
        targetSessionKey: "agent:main:main",
        messageTemplate: "Error detected: {{eventName}}",
      },
      cooldownMs: 0,
      tags: ["errors"],
      priority: "high",
    });

    const noMatch = evaluateRules({ eventName: "info.status_ok" });
    expect(noMatch).toHaveLength(0);

    const match = evaluateRules({ eventName: "system.error" });
    expect(match).toHaveLength(1);
  });

  it("evaluates pattern conditions on event text", () => {
    registerTriggerRule({
      id: "rule-log",
      name: "Log Pattern",
      enabled: true,
      conditions: [{ type: "pattern", textPattern: "서버.*다운" }],
      action: {
        type: "agent_prompt",
        targetSessionKey: "agent:main:main",
        messageTemplate: "서버 다운 감지됨",
      },
      cooldownMs: 0,
      tags: ["server"],
      priority: "critical",
    });

    const noMatch = evaluateRules({ eventText: "서버 정상 가동 중" });
    expect(noMatch).toHaveLength(0);

    const match = evaluateRules({ eventText: "서버가 다운되었습니다" });
    expect(match).toHaveLength(1);
  });

  it("respects cooldown periods", () => {
    registerTriggerRule({
      id: "rule-cool",
      name: "Cooldown Test",
      enabled: true,
      conditions: [{ type: "metric_threshold", metric: "temp", threshold: 50, operator: "gt" }],
      action: {
        type: "agent_prompt",
        targetSessionKey: "agent:main:main",
        messageTemplate: "Temp high",
      },
      cooldownMs: 60_000, // 1 minute cooldown
      tags: [],
      priority: "normal",
    });

    // First evaluation — fires
    const first = evaluateRules({ metrics: { temp: 60 } });
    expect(first).toHaveLength(1);

    // Second evaluation — blocked by cooldown
    const second = evaluateRules({ metrics: { temp: 60 } });
    expect(second).toHaveLength(0);
  });

  it("skips disabled rules", () => {
    registerTriggerRule({
      id: "rule-disabled",
      name: "Disabled",
      enabled: false,
      conditions: [{ type: "metric_threshold", metric: "x", threshold: 0, operator: "gt" }],
      action: {
        type: "agent_prompt",
        targetSessionKey: "agent:main:main",
        messageTemplate: "should not fire",
      },
      cooldownMs: 0,
      tags: [],
      priority: "normal",
    });

    const triggers = evaluateRules({ metrics: { x: 100 } });
    expect(triggers).toHaveLength(0);
  });
});

describe("Metrics", () => {
  it("stores and retrieves metrics", () => {
    updateMetric("cpu", 75);
    updateMetric("memory", 60);

    expect(getMetric("cpu")).toBe(75);
    expect(getMetric("memory")).toBe(60);
    expect(getMetric("unknown")).toBeUndefined();

    const all = getAllMetrics();
    expect(all).toEqual({ cpu: 75, memory: 60 });
  });
});
