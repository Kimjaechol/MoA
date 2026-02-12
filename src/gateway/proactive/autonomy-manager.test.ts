import { describe, it, expect, beforeEach } from "vitest";
import { sendAgentMessage, resetBridgeForTest } from "./agent-bridge.js";
import { addJournalEntry, resetJournalForTest } from "./agent-journal.js";
import {
  setAutonomyConfig,
  getAutonomyConfig,
  setSystemEventCallback,
  setAgentTurnCallback,
  runAutonomyCycle,
  getAutonomyState,
  hasUrgentWork,
  resetAutonomyManagerForTest,
} from "./autonomy-manager.js";
import { registerTriggerRule, resetTriggerEngineForTest, updateMetric } from "./trigger-engine.js";

beforeEach(() => {
  resetAutonomyManagerForTest();
  resetTriggerEngineForTest();
  resetJournalForTest();
  resetBridgeForTest();
});

describe("Autonomy Manager Configuration", () => {
  it("provides default configuration", () => {
    const config = getAutonomyConfig();
    expect(config.enabled).toBe(true);
    expect(config.maxTriggersPerCycle).toBe(5);
    expect(config.maxConcurrentAgentRuns).toBe(3);
    expect(config.defaultCooldownMs).toBe(60_000);
    expect(config.allowUnpromptedA2A).toBe(true);
    expect(config.allowUnpromptedChannelMessages).toBe(false);
  });

  it("updates configuration", () => {
    setAutonomyConfig({ maxTriggersPerCycle: 10, enabled: false });
    const config = getAutonomyConfig();
    expect(config.maxTriggersPerCycle).toBe(10);
    expect(config.enabled).toBe(false);
  });
});

describe("Autonomy Cycle", () => {
  it("returns zero counts when disabled", async () => {
    setAutonomyConfig({ enabled: false });

    const result = await runAutonomyCycle({
      sessionKey: "agent:main:main",
    });

    expect(result.triggersProcessed).toBe(0);
    expect(result.a2aProcessed).toBe(0);
  });

  it("evaluates trigger rules and processes triggers", async () => {
    const systemEvents: Array<{ key: string; text: string }> = [];
    setSystemEventCallback((key, text) => {
      systemEvents.push({ key, text });
    });

    // Set up a rule that fires on high CPU
    registerTriggerRule({
      id: "cpu-rule",
      name: "CPU Alert",
      enabled: true,
      conditions: [{ type: "metric_threshold", metric: "cpu", threshold: 90, operator: "gt" }],
      action: {
        type: "agent_prompt",
        targetSessionKey: "agent:devops:main",
        messageTemplate: "CPU at {{cpu}}%, investigate now.",
      },
      cooldownMs: 0,
      tags: ["monitoring"],
      priority: "normal",
    });

    const result = await runAutonomyCycle({
      sessionKey: "agent:main:main",
      metrics: { cpu: 95 },
    });

    expect(result.triggersProcessed).toBe(1);
    expect(systemEvents).toHaveLength(1);
    expect(systemEvents[0].text).toContain("CPU at 95%");
  });

  it("includes journal context for high-priority triggers", async () => {
    const agentTurns: Array<{
      sessionKey: string;
      message: string;
      systemPrompt?: string;
    }> = [];

    setAgentTurnCallback(async (params) => {
      agentTurns.push({
        sessionKey: params.sessionKey,
        message: params.message,
        systemPrompt: params.extraSystemPrompt,
      });
      return "Action taken.";
    });

    // Add a journal directive for the devops agent
    addJournalEntry({
      agentId: "devops",
      content: "서버가 다운되면 먼저 로그를 확인하고, 그 다음 개발자에게 전화하라",
      type: "directive",
      priority: "critical",
    });

    // Set up a high-priority trigger rule
    registerTriggerRule({
      id: "server-down",
      name: "Server Down",
      enabled: true,
      conditions: [{ type: "pattern", textPattern: "server.*down" }],
      action: {
        type: "agent_prompt",
        targetSessionKey: "agent:devops:main",
        messageTemplate: "Server appears to be down. Check immediately.",
      },
      cooldownMs: 0,
      tags: ["server"],
      priority: "high",
    });

    const result = await runAutonomyCycle({
      sessionKey: "agent:main:main",
      eventText: "Alert: server is down",
    });

    expect(result.triggersProcessed).toBe(1);
    expect(agentTurns).toHaveLength(1);
    // Agent turn should include journal context
    expect(agentTurns[0].systemPrompt).toContain("서버가 다운되면");
    expect(agentTurns[0].systemPrompt).toContain("로그를 확인");
  });

  it("processes A2A bridge messages", async () => {
    const agentTurns: Array<{ sessionKey: string; message: string }> = [];

    setAgentTurnCallback(async (params) => {
      agentTurns.push({
        sessionKey: params.sessionKey,
        message: params.message,
      });
      return "Done.";
    });

    // Send an A2A message
    sendAgentMessage({
      fromAgent: "agent:research:main",
      toAgent: "agent:main:main",
      message: "리서치 결과를 정리해서 보고서를 작성해주세요",
      treatAsUserCommand: true,
    });

    const result = await runAutonomyCycle({
      sessionKey: "agent:main:main",
    });

    // A2A messages are processed as agent turns
    expect(result.a2aProcessed).toBe(1);
    expect(agentTurns).toHaveLength(1);
    expect(agentTurns[0].message).toContain("리서치 결과를 정리");
  });

  it("handles errors gracefully", async () => {
    setAgentTurnCallback(async () => {
      throw new Error("Agent failed");
    });

    registerTriggerRule({
      id: "fail-rule",
      name: "Failing Rule",
      enabled: true,
      conditions: [{ type: "metric_threshold", metric: "x", threshold: 0, operator: "gt" }],
      action: {
        type: "agent_prompt",
        targetSessionKey: "agent:main:main",
        messageTemplate: "Test",
      },
      cooldownMs: 0,
      tags: [],
      priority: "high",
    });

    const result = await runAutonomyCycle({
      sessionKey: "agent:main:main",
      metrics: { x: 1 },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Agent failed");
  });

  it("prevents concurrent cycle execution", async () => {
    let resolveCallback: (() => void) | null = null;
    setSystemEventCallback(() => {
      // Block the callback
      return new Promise<void>((resolve) => {
        resolveCallback = resolve;
      }) as unknown as void;
    });

    registerTriggerRule({
      id: "slow-rule",
      name: "Slow",
      enabled: true,
      conditions: [{ type: "metric_threshold", metric: "x", threshold: 0, operator: "gt" }],
      action: {
        type: "agent_prompt",
        targetSessionKey: "agent:main:main",
        messageTemplate: "slow",
      },
      cooldownMs: 0,
      tags: [],
      priority: "normal",
    });

    // Start first cycle
    const first = runAutonomyCycle({
      sessionKey: "agent:main:main",
      metrics: { x: 1 },
    });

    // Try second cycle while first is running
    const second = await runAutonomyCycle({
      sessionKey: "agent:main:main",
      metrics: { x: 1 },
    });

    expect(second.errors).toContain("cycle already running");

    // Clean up
    resolveCallback?.();
    await first;
  });
});

describe("Autonomy State", () => {
  it("provides state snapshot", () => {
    const state = getAutonomyState();
    expect(state.enabled).toBe(true);
    expect(state.pendingTriggers).toBe(0);
    expect(state.pendingBridgeMessages).toBe(0);
    expect(typeof state.lastHeartbeatMs).toBe("number");
  });

  it("detects urgent work", () => {
    expect(hasUrgentWork("main")).toBe(false);

    addJournalEntry({
      agentId: "main",
      content: "URGENT",
      type: "directive",
      priority: "critical",
    });

    expect(hasUrgentWork("main")).toBe(true);
  });
});
