import { describe, it, expect, beforeEach } from "vitest";
import {
  sendAgentMessage,
  recordBridgeResponse,
  drainMessagesForAgent,
  getResponsesForMessage,
  getPendingMessages,
  getBridgeStats,
  registerRouteHandler,
  invokeRouteHandler,
  resetBridgeForTest,
} from "./agent-bridge.js";
import { resetTriggerEngineForTest, peekTriggerQueue } from "./trigger-engine.js";

beforeEach(() => {
  resetBridgeForTest();
  resetTriggerEngineForTest();
});

describe("Agent Bridge", () => {
  it("sends messages between agents", () => {
    const msg = sendAgentMessage({
      fromAgent: "agent:research:main",
      toAgent: "agent:writer:main",
      message: "리서치 결과를 바탕으로 기사를 작성해주세요",
      tags: ["research", "writing"],
      priority: "normal",
    });

    expect(msg.id).toBeTruthy();
    expect(msg.fromAgent).toBe("agent:research:main");
    expect(msg.toAgent).toBe("agent:writer:main");
    expect(msg.treatAsUserCommand).toBe(true); // default
    expect(getPendingMessages()).toHaveLength(1);
  });

  it("creates a trigger event for A2A messages", () => {
    sendAgentMessage({
      fromAgent: "agent:monitor:main",
      toAgent: "agent:devops:main",
      message: "서버 CPU 95% — 확인 바랍니다",
      priority: "high",
    });

    const triggers = peekTriggerQueue();
    expect(triggers).toHaveLength(1);
    expect(triggers[0].source).toBe("agent_message");
    expect(triggers[0].priority).toBe("high");
    expect(triggers[0].tags).toContain("a2a");
  });

  it("drains messages for a specific agent", () => {
    sendAgentMessage({
      fromAgent: "agent:a1:main",
      toAgent: "agent:target:main",
      message: "Message 1",
    });
    sendAgentMessage({
      fromAgent: "agent:a2:main",
      toAgent: "agent:target:main",
      message: "Message 2",
      priority: "high",
    });
    sendAgentMessage({
      fromAgent: "agent:a1:main",
      toAgent: "agent:other:main",
      message: "Different target",
    });

    const targetMessages = drainMessagesForAgent("agent:target:main");
    expect(targetMessages).toHaveLength(2);
    // High priority first
    expect(targetMessages[0].priority).toBe("high");
    expect(targetMessages[1].priority).toBe("normal");

    // Other agent's messages remain
    expect(getPendingMessages()).toHaveLength(1);
    expect(getPendingMessages()[0].toAgent).toBe("agent:other:main");
  });

  it("records and retrieves responses", () => {
    const msg = sendAgentMessage({
      fromAgent: "agent:a1:main",
      toAgent: "agent:a2:main",
      message: "질문입니다",
      expectResponse: true,
    });

    recordBridgeResponse({
      messageId: msg.id,
      fromAgent: "agent:a2:main",
      toAgent: "agent:a1:main",
      response: "답변입니다",
      tags: ["answer"],
    });

    const responses = getResponsesForMessage(msg.id);
    expect(responses).toHaveLength(1);
    expect(responses[0].response).toBe("답변입니다");

    // Message should be removed from pending
    expect(getPendingMessages()).toHaveLength(0);
  });

  it("provides bridge statistics", () => {
    sendAgentMessage({
      fromAgent: "agent:a1:main",
      toAgent: "agent:a2:main",
      message: "msg 1",
      priority: "high",
    });
    sendAgentMessage({
      fromAgent: "agent:a1:main",
      toAgent: "agent:a3:main",
      message: "msg 2",
      priority: "normal",
    });
    sendAgentMessage({
      fromAgent: "agent:a2:main",
      toAgent: "agent:a1:main",
      message: "reply",
      priority: "normal",
    });

    const stats = getBridgeStats();
    expect(stats.pendingMessages).toBe(3);
    expect(stats.messagesByPriority.high).toBe(1);
    expect(stats.messagesByPriority.normal).toBe(2);
    expect(stats.topSenders).toHaveLength(2);
    expect(stats.topSenders[0].agent).toBe("agent:a1:main");
    expect(stats.topSenders[0].count).toBe(2);
  });

  it("supports treatAsUserCommand flag", () => {
    const cmdMsg = sendAgentMessage({
      fromAgent: "agent:scheduler:main",
      toAgent: "agent:worker:main",
      message: "일일 보고서를 작성하라",
      treatAsUserCommand: true,
    });
    expect(cmdMsg.treatAsUserCommand).toBe(true);

    const infoMsg = sendAgentMessage({
      fromAgent: "agent:monitor:main",
      toAgent: "agent:logger:main",
      message: "참고: CPU 정상 범위 내",
      treatAsUserCommand: false,
    });
    expect(infoMsg.treatAsUserCommand).toBe(false);
  });

  it("enforces drain limit", () => {
    for (let i = 0; i < 20; i++) {
      sendAgentMessage({
        fromAgent: "agent:sender:main",
        toAgent: "agent:receiver:main",
        message: `Message ${i}`,
      });
    }

    const batch = drainMessagesForAgent("agent:receiver:main", 5);
    expect(batch).toHaveLength(5);
    expect(getPendingMessages()).toHaveLength(15);
  });
});

describe("Route Handlers", () => {
  it("registers and invokes route handlers", async () => {
    registerRouteHandler("agent:echo:main", async (msg) => {
      return `Echo: ${msg.message}`;
    });

    const msg = sendAgentMessage({
      fromAgent: "agent:test:main",
      toAgent: "agent:echo:main",
      message: "Hello",
    });

    // Drain message from pending
    const drained = drainMessagesForAgent("agent:echo:main");
    const response = await invokeRouteHandler(drained[0]);
    expect(response).toBe("Echo: Hello");
  });

  it("returns null for unmatched routes", async () => {
    const msg = sendAgentMessage({
      fromAgent: "agent:a1:main",
      toAgent: "agent:unknown:main",
      message: "test",
    });

    const drained = drainMessagesForAgent("agent:unknown:main");
    const response = await invokeRouteHandler(drained[0]);
    expect(response).toBeNull();
  });
});
