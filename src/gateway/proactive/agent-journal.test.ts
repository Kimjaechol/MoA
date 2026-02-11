import { describe, it, expect, beforeEach } from "vitest";
import {
  addJournalEntry,
  getActiveJournalEntries,
  buildJournalPrompt,
  deactivateJournalEntry,
  getAllJournalEntries,
  getJournalStats,
  hasUrgentDirectives,
  serializeJournalToMarkdown,
  resetJournalForTest,
} from "./agent-journal.js";

beforeEach(() => {
  resetJournalForTest();
});

describe("Agent Journal", () => {
  it("adds and retrieves journal entries", () => {
    addJournalEntry({
      agentId: "main",
      content: "서버가 다운되면 개발자에게 전화하라",
      type: "directive",
      priority: "critical",
      tags: ["server", "alert"],
    });

    addJournalEntry({
      agentId: "main",
      content: "매일 오전 9시에 일일 보고를 작성하라",
      type: "directive",
      priority: "normal",
      tags: ["daily", "report"],
    });

    const entries = getActiveJournalEntries("main");
    expect(entries).toHaveLength(2);
    // Critical should come first
    expect(entries[0].priority).toBe("critical");
    expect(entries[0].content).toContain("서버가 다운되면");
  });

  it("filters by type", () => {
    addJournalEntry({
      agentId: "agent-1",
      content: "Always respond in Korean",
      type: "directive",
    });
    addJournalEntry({
      agentId: "agent-1",
      content: "Today I learned about cron jobs",
      type: "learning",
    });
    addJournalEntry({
      agentId: "agent-1",
      content: "Notice: CPU has been high lately",
      type: "observation",
    });

    const directives = getActiveJournalEntries("agent-1", {
      types: ["directive"],
    });
    expect(directives).toHaveLength(1);
    expect(directives[0].type).toBe("directive");

    const learnings = getActiveJournalEntries("agent-1", {
      types: ["learning", "observation"],
    });
    expect(learnings).toHaveLength(2);
  });

  it("filters by tags", () => {
    addJournalEntry({
      agentId: "agent-1",
      content: "Monitor server health",
      type: "directive",
      tags: ["server", "monitoring"],
    });
    addJournalEntry({
      agentId: "agent-1",
      content: "Write daily report",
      type: "directive",
      tags: ["daily", "report"],
    });

    const serverEntries = getActiveJournalEntries("agent-1", {
      tags: ["server"],
    });
    expect(serverEntries).toHaveLength(1);
    expect(serverEntries[0].content).toContain("server health");
  });

  it("deactivates expired entries", () => {
    addJournalEntry({
      agentId: "agent-1",
      content: "Temporary reminder",
      type: "reminder",
      expiresAtMs: Date.now() - 1000, // already expired
    });
    addJournalEntry({
      agentId: "agent-1",
      content: "Permanent directive",
      type: "directive",
    });

    const entries = getActiveJournalEntries("agent-1");
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toContain("Permanent");
  });

  it("deactivates entries manually", () => {
    const entry = addJournalEntry({
      agentId: "agent-1",
      content: "Task done",
      type: "plan",
    });

    expect(getActiveJournalEntries("agent-1")).toHaveLength(1);

    deactivateJournalEntry(entry.id);
    expect(getActiveJournalEntries("agent-1")).toHaveLength(0);
  });

  it("builds journal prompt with grouped sections", () => {
    addJournalEntry({
      agentId: "main",
      content: "서버 다운 시 개발자에게 전화",
      type: "directive",
      priority: "critical",
    });
    addJournalEntry({
      agentId: "main",
      content: "CPU 모니터링 결과 안정적",
      type: "observation",
    });
    addJournalEntry({
      agentId: "main",
      content: "내일 배포 예정",
      type: "plan",
    });
    addJournalEntry({
      agentId: "main",
      content: "로그 확인 후 행동하는 것이 효과적",
      type: "learning",
    });

    const prompt = buildJournalPrompt("main", {
      triggerSource: "heartbeat (30m cycle)",
    });

    expect(prompt).toContain("Standing Directives");
    expect(prompt).toContain("[CRITICAL]");
    expect(prompt).toContain("서버 다운 시");
    expect(prompt).toContain("Recent Observations");
    expect(prompt).toContain("Planned Actions");
    expect(prompt).toContain("Learnings");
    expect(prompt).toContain("Triggered by: heartbeat");
  });

  it("returns empty string when no entries exist", () => {
    const prompt = buildJournalPrompt("nonexistent-agent");
    expect(prompt).toBe("");
  });

  it("detects urgent directives", () => {
    expect(hasUrgentDirectives("main")).toBe(false);

    addJournalEntry({
      agentId: "main",
      content: "Normal task",
      type: "directive",
      priority: "normal",
    });
    expect(hasUrgentDirectives("main")).toBe(false);

    addJournalEntry({
      agentId: "main",
      content: "URGENT: Server monitoring",
      type: "directive",
      priority: "critical",
    });
    expect(hasUrgentDirectives("main")).toBe(true);
  });

  it("provides accurate journal stats", () => {
    addJournalEntry({ agentId: "a1", content: "d1", type: "directive", priority: "high" });
    addJournalEntry({ agentId: "a1", content: "d2", type: "directive", priority: "normal" });
    addJournalEntry({ agentId: "a1", content: "o1", type: "observation" });

    const stats = getJournalStats("a1");
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(3);
    expect(stats.byType.directive).toBe(2);
    expect(stats.byType.observation).toBe(1);
    expect(stats.byPriority.high).toBe(1);
    expect(stats.byPriority.normal).toBe(2);
  });

  it("serializes journal to Markdown", () => {
    addJournalEntry({
      agentId: "main",
      content: "Test directive content",
      type: "directive",
      priority: "high",
      tags: ["test"],
    });

    const md = serializeJournalToMarkdown("main");
    expect(md).toContain("# Agent Journal: main");
    expect(md).toContain("[ACTIVE] DIRECTIVE");
    expect(md).toContain("Priority: high");
    expect(md).toContain("Tags: test");
    expect(md).toContain("Test directive content");
  });

  it("respects entry limit", () => {
    for (let i = 0; i < 30; i++) {
      addJournalEntry({
        agentId: "main",
        content: `Entry ${i}`,
        type: "observation",
      });
    }

    const limited = getActiveJournalEntries("main", { limit: 5 });
    expect(limited).toHaveLength(5);
  });

  it("isolates journals per agent", () => {
    addJournalEntry({ agentId: "a1", content: "For A1", type: "directive" });
    addJournalEntry({ agentId: "a2", content: "For A2", type: "directive" });

    expect(getActiveJournalEntries("a1")).toHaveLength(1);
    expect(getActiveJournalEntries("a2")).toHaveLength(1);
    expect(getActiveJournalEntries("a1")[0].content).toBe("For A1");
    expect(getActiveJournalEntries("a2")[0].content).toBe("For A2");
  });
});
