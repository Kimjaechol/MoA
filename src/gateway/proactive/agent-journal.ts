/**
 * MoA Proactive Agent System — Agent Journal (Diary)
 *
 * The agent journal is a markdown-based diary system that agents
 * read before taking any action. This is the "프롬프트 엔지니어링"
 * layer that gives agents standing orders, learned behaviors,
 * and self-awareness.
 *
 * How it works:
 *   1. Agent receives a trigger (heartbeat, cron, state change, A2A)
 *   2. Before processing, agent reads active journal entries
 *   3. Journal entries provide: directives, plans, reminders, learnings
 *   4. Agent acts with full context of its own history and standing orders
 *
 * This is analogous to a human checking their notes/todo list
 * before starting work each morning.
 *
 * Storage: in-memory with file-based persistence per agent.
 * Format: YAML frontmatter + Markdown body (same as memory system).
 */

import type { JournalEntry, JournalEntryType, TriggerPriority } from "./types.js";

// ─── Journal Storage ───

/** Per-agent journal entries */
const journals = new Map<string, JournalEntry[]>();

let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `jrn_${Date.now()}_${idCounter}`;
}

// ─── Journal Operations ───

/**
 * Add a new entry to an agent's journal.
 * Agents write journal entries to record directives, observations,
 * plans, reflections, reminders, and learnings.
 */
export function addJournalEntry(params: {
  agentId: string;
  content: string;
  type: JournalEntryType;
  tags?: string[];
  priority?: TriggerPriority;
  expiresAtMs?: number;
  relatedRuleIds?: string[];
}): JournalEntry {
  const entry: JournalEntry = {
    id: generateId(),
    agentId: params.agentId,
    timestamp: Date.now(),
    content: params.content,
    tags: params.tags ?? [],
    type: params.type,
    priority: params.priority ?? "normal",
    active: true,
    expiresAtMs: params.expiresAtMs,
    relatedRuleIds: params.relatedRuleIds,
  };

  const agentJournal = journals.get(params.agentId) ?? [];
  agentJournal.push(entry);
  journals.set(params.agentId, agentJournal);

  return entry;
}

/**
 * Get active journal entries for an agent, ordered by priority.
 * This is what the agent reads before each action.
 *
 * Expired entries are automatically deactivated.
 */
export function getActiveJournalEntries(
  agentId: string,
  options?: {
    types?: JournalEntryType[];
    tags?: string[];
    limit?: number;
    minPriority?: TriggerPriority;
  },
): JournalEntry[] {
  const now = Date.now();
  const agentJournal = journals.get(agentId) ?? [];

  // Deactivate expired entries
  for (const entry of agentJournal) {
    if (entry.active && entry.expiresAtMs && entry.expiresAtMs <= now) {
      entry.active = false;
    }
  }

  let entries = agentJournal.filter((e) => e.active);

  // Filter by type
  if (options?.types?.length) {
    entries = entries.filter((e) => options.types!.includes(e.type));
  }

  // Filter by tags
  if (options?.tags?.length) {
    entries = entries.filter((e) => options.tags!.some((tag) => e.tags.includes(tag)));
  }

  // Filter by minimum priority
  if (options?.minPriority) {
    const minOrder = PRIORITY_ORDER[options.minPriority];
    entries = entries.filter((e) => PRIORITY_ORDER[e.priority] <= minOrder);
  }

  // Sort: priority first, then newest
  entries.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority];
    const pb = PRIORITY_ORDER[b.priority];
    if (pa !== pb) {
      return pa - pb;
    }
    return b.timestamp - a.timestamp;
  });

  return entries.slice(0, options?.limit ?? 20);
}

/**
 * Build the journal prompt that is injected before agent actions.
 * This is the "read diary before acting" step.
 *
 * Returns a formatted string that becomes part of the agent's
 * system prompt or context.
 */
export function buildJournalPrompt(
  agentId: string,
  options?: {
    triggerSource?: string;
    maxEntries?: number;
  },
): string {
  const entries = getActiveJournalEntries(agentId, {
    limit: options?.maxEntries ?? 10,
  });

  if (entries.length === 0) {
    return "";
  }

  const lines: string[] = ["── Agent Journal (Active Directives & Context) ──", ""];

  // Group by type for readability
  const directives = entries.filter((e) => e.type === "directive");
  const reminders = entries.filter((e) => e.type === "reminder");
  const plans = entries.filter((e) => e.type === "plan");
  const observations = entries.filter((e) => e.type === "observation");
  const learnings = entries.filter((e) => e.type === "learning");
  const reflections = entries.filter((e) => e.type === "reflection");

  if (directives.length > 0) {
    lines.push("## Standing Directives (지시사항)");
    for (const d of directives) {
      const priorityLabel =
        d.priority === "critical" ? " [CRITICAL]" : d.priority === "high" ? " [HIGH]" : "";
      lines.push(`- ${priorityLabel}${d.content}`);
      if (d.tags.length > 0) {
        lines.push(`  Tags: ${d.tags.join(", ")}`);
      }
    }
    lines.push("");
  }

  if (reminders.length > 0) {
    lines.push("## Active Reminders (리마인더)");
    for (const r of reminders) {
      const timeStr = new Date(r.timestamp).toISOString();
      lines.push(`- [${timeStr}] ${r.content}`);
    }
    lines.push("");
  }

  if (plans.length > 0) {
    lines.push("## Planned Actions (계획)");
    for (const p of plans) {
      lines.push(`- ${p.content}`);
    }
    lines.push("");
  }

  if (observations.length > 0) {
    lines.push("## Recent Observations (관찰)");
    for (const o of observations) {
      lines.push(`- ${o.content}`);
    }
    lines.push("");
  }

  if (learnings.length > 0) {
    lines.push("## Learnings (학습)");
    for (const l of learnings) {
      lines.push(`- ${l.content}`);
    }
    lines.push("");
  }

  if (reflections.length > 0) {
    lines.push("## Self-Reflections (성찰)");
    for (const r of reflections) {
      lines.push(`- ${r.content}`);
    }
    lines.push("");
  }

  if (options?.triggerSource) {
    lines.push(`── Triggered by: ${options.triggerSource} ──`);
  }

  return lines.join("\n");
}

/**
 * Deactivate a journal entry (mark as resolved).
 */
export function deactivateJournalEntry(entryId: string): boolean {
  for (const agentJournal of journals.values()) {
    const entry = agentJournal.find((e) => e.id === entryId);
    if (entry) {
      entry.active = false;
      return true;
    }
  }
  return false;
}

/**
 * Get all journal entries for an agent (including inactive).
 */
export function getAllJournalEntries(
  agentId: string,
  options?: { includeInactive?: boolean; limit?: number },
): JournalEntry[] {
  const agentJournal = journals.get(agentId) ?? [];
  let entries = options?.includeInactive ? agentJournal : agentJournal.filter((e) => e.active);

  entries = entries.toSorted((a, b) => b.timestamp - a.timestamp);
  return entries.slice(0, options?.limit ?? 100);
}

/**
 * Get journal statistics for an agent.
 */
export function getJournalStats(agentId: string): {
  total: number;
  active: number;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
} {
  const agentJournal = journals.get(agentId) ?? [];
  const active = agentJournal.filter((e) => e.active);

  const byType: Record<string, number> = {};
  const byPriority: Record<string, number> = {};

  for (const entry of active) {
    byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    byPriority[entry.priority] = (byPriority[entry.priority] ?? 0) + 1;
  }

  return {
    total: agentJournal.length,
    active: active.length,
    byType,
    byPriority,
  };
}

/**
 * Check if an agent has any high-priority directives that
 * should be acted upon immediately.
 */
export function hasUrgentDirectives(agentId: string): boolean {
  const entries = getActiveJournalEntries(agentId, {
    types: ["directive"],
    minPriority: "high",
  });
  return entries.length > 0;
}

/**
 * Serialize journal entries to Markdown format for persistence.
 * The journal is stored as AGENT_JOURNAL.md in the agent workspace.
 */
export function serializeJournalToMarkdown(agentId: string): string {
  const entries = getAllJournalEntries(agentId, { includeInactive: true });

  if (entries.length === 0) {
    return `# Agent Journal: ${agentId}\n\nNo entries yet.\n`;
  }

  const lines: string[] = [
    `# Agent Journal: ${agentId}`,
    "",
    `Last updated: ${new Date().toISOString()}`,
    "",
  ];

  for (const entry of entries) {
    const status = entry.active ? "ACTIVE" : "RESOLVED";
    const dateStr = new Date(entry.timestamp).toISOString().slice(0, 19);

    lines.push("---");
    lines.push(`## [${status}] ${entry.type.toUpperCase()} — ${dateStr}`);
    lines.push(`Priority: ${entry.priority}`);
    if (entry.tags.length > 0) {
      lines.push(`Tags: ${entry.tags.join(", ")}`);
    }
    lines.push("");
    lines.push(entry.content);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Helpers ───

const PRIORITY_ORDER: Record<TriggerPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ─── Reset (for testing) ───

export function resetJournalForTest(): void {
  journals.clear();
  idCounter = 0;
}
