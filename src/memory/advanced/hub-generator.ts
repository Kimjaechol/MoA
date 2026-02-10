/**
 * MoA Advanced Memory System - Hub Document Generator
 *
 * Auto-generates and updates Obsidian-style MOC (Map of Content) hub documents.
 * Hub documents serve as indexes for cases, people, knowledge, and domains.
 */

import type { DatabaseSync } from "node:sqlite";
import type { HubType } from "./types.js";

// ─── Hub Document Generation ───

/**
 * Generate or refresh a hub document.
 * Returns the markdown content for the hub.
 */
export function generateHubDocument(db: DatabaseSync, hubType: HubType): string {
  switch (hubType) {
    case "cases":
      return generateCasesHub(db);
    case "people":
      return generatePeopleHub(db);
    case "knowledge":
      return generateKnowledgeHub(db);
    case "domains":
      return generateDomainsHub(db);
    case "timeline":
      return generateTimelineHub(db);
    default:
      return `# Hub: ${String(hubType)}\n\nNo data available.`;
  }
}

// ─── Cases Hub ───

function generateCasesHub(db: DatabaseSync): string {
  const now = new Date().toISOString();

  const activeCases = db
    .prepare(
      `SELECT n.*, COUNT(DISTINCT e.id) as edge_count
       FROM nodes n
       LEFT JOIN edges e ON n.id = e.from_node OR n.id = e.to_node
       WHERE n.type = 'case' AND n.status = 'active'
       GROUP BY n.id
       ORDER BY n.importance DESC, n.updated_at DESC`,
    )
    .all() as Array<RawNodeWithCount>;

  const resolvedCases = db
    .prepare(
      `SELECT n.*
       FROM nodes n
       WHERE n.type = 'case' AND n.status IN ('resolved', 'archived')
       ORDER BY n.updated_at DESC
       LIMIT 20`,
    )
    .all() as Array<RawNodeRow>;

  let md = `---\ntype: hub\nscope: cases\nauto_generated: true\nlast_updated: "${now}"\n---\n\n`;
  md += "# Cases Index\n\n";

  // Active cases
  md += "## Active Cases\n\n";
  if (activeCases.length === 0) {
    md += "No active cases.\n\n";
  } else {
    md += "| Case | Type | Related People | Last Updated | Importance |\n";
    md += "|------|------|---------------|-------------|------------|\n";
    for (const c of activeCases) {
      const people = getRelatedPeopleNames(db, c.id);
      const peopleStr = people.length > 0 ? people.map((p) => `[[${p}]]`).join(", ") : "-";
      md += `| [[${c.name}]] | ${c.subtype ?? "-"} | ${peopleStr} | ${formatDate(c.updated_at)} | ${c.importance}/10 |\n`;
    }
    md += "\n";
  }

  // Resolved cases
  md += "## Resolved / Archived Cases\n\n";
  if (resolvedCases.length === 0) {
    md += "No resolved cases.\n\n";
  } else {
    md += "| Case | Type | Status | Resolved |\n";
    md += "|------|------|--------|----------|\n";
    for (const c of resolvedCases) {
      md += `| [[${c.name}]] | ${c.subtype ?? "-"} | ${c.status} | ${formatDate(c.updated_at)} |\n`;
    }
    md += "\n";
  }

  // Stats
  md += "## Stats\n\n";
  md += `- Active: ${activeCases.length}\n`;
  md += `- Resolved/Archived: ${resolvedCases.length}\n`;

  return md;
}

// ─── People Hub ───

function generatePeopleHub(db: DatabaseSync): string {
  const now = new Date().toISOString();

  const people = db
    .prepare(
      `SELECT n.*, COUNT(DISTINCT e.id) as edge_count
       FROM nodes n
       LEFT JOIN edges e ON n.id = e.from_node OR n.id = e.to_node
       WHERE n.type = 'person' AND n.status = 'active'
       GROUP BY n.id
       ORDER BY edge_count DESC, n.importance DESC`,
    )
    .all() as Array<RawNodeWithCount>;

  let md = `---\ntype: hub\nscope: people\nauto_generated: true\nlast_updated: "${now}"\n---\n\n`;
  md += "# People Index\n\n";

  if (people.length === 0) {
    md += "No people tracked yet.\n\n";
    return md;
  }

  md += "| Person | Role | Active Cases | Connections | Last Active |\n";
  md += "|--------|------|-------------|------------|-------------|\n";

  for (const p of people) {
    const cases = getRelatedCaseNames(db, p.id);
    const casesStr = cases.length > 0 ? cases.map((c) => `[[${c}]]`).join(", ") : "-";
    md += `| [[${p.name}]] | ${p.subtype ?? "-"} | ${casesStr} | ${p.edge_count} | ${formatDate(p.updated_at)} |\n`;
  }
  md += "\n";
  md += `Total people tracked: ${people.length}\n`;

  return md;
}

// ─── Knowledge Hub ───

function generateKnowledgeHub(db: DatabaseSync): string {
  const now = new Date().toISOString();

  // Group knowledge nodes by domain
  const knowledgeNodes = db
    .prepare(
      `SELECT n.*, COALESCE(json_extract(n.properties, '$.domain'), 'general') as domain
       FROM nodes n
       WHERE n.type = 'knowledge' AND n.status = 'active'
       ORDER BY domain, n.importance DESC`,
    )
    .all() as Array<RawNodeRow & { domain: string }>;

  let md = `---\ntype: hub\nscope: knowledge\nauto_generated: true\nlast_updated: "${now}"\n---\n\n`;
  md += "# Knowledge Base Index\n\n";

  if (knowledgeNodes.length === 0) {
    md +=
      "No knowledge entries yet. Upload documents or share knowledge to build your personal database.\n\n";
    return md;
  }

  // Group by domain
  const byDomain = new Map<string, Array<RawNodeRow & { domain: string }>>();
  for (const node of knowledgeNodes) {
    const domain = node.domain;
    if (!byDomain.has(domain)) {
      byDomain.set(domain, []);
    }
    byDomain.get(domain)!.push(node);
  }

  for (const [domain, nodes] of byDomain) {
    md += `## ${capitalizeFirst(domain)}\n\n`;
    for (const node of nodes) {
      const children = getChildKnowledgeNodes(db, node.id);
      md += `- [[${node.name}]]`;
      if (children.length > 0) {
        md += `\n`;
        for (const child of children) {
          md += `  - [[${child}]]\n`;
        }
      } else {
        md += "\n";
      }
    }
    md += "\n";
  }

  md += `Total knowledge entries: ${knowledgeNodes.length}\n`;
  md += `Domains covered: ${byDomain.size}\n`;

  return md;
}

// ─── Domains Hub ───

function generateDomainsHub(db: DatabaseSync): string {
  const now = new Date().toISOString();

  const domains = db
    .prepare(
      `SELECT domain, COUNT(*) as count
       FROM chunk_metadata
       WHERE domain IS NOT NULL
       GROUP BY domain
       ORDER BY count DESC`,
    )
    .all() as Array<{ domain: string; count: number }>;

  let md = `---\ntype: hub\nscope: domains\nauto_generated: true\nlast_updated: "${now}"\n---\n\n`;
  md += "# Domain Distribution\n\n";

  if (domains.length === 0) {
    md += "No domain data yet.\n\n";
    return md;
  }

  md += "| Domain | Entries | Distribution |\n";
  md += "|--------|---------|-------------|\n";

  const total = domains.reduce((sum, d) => sum + d.count, 0);
  for (const d of domains) {
    const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
    const bar = "█".repeat(Math.max(1, Math.round((d.count / total) * 20)));
    md += `| ${capitalizeFirst(d.domain)} | ${d.count} | ${bar} ${pct}% |\n`;
  }
  md += "\n";

  return md;
}

// ─── Timeline Hub ───

function generateTimelineHub(db: DatabaseSync): string {
  const now = new Date().toISOString();

  const recentActivity = db
    .prepare(
      `SELECT date(cm.created_at) as day, cm.type, COUNT(*) as count,
              GROUP_CONCAT(DISTINCT cm.case_ref) as cases
       FROM chunk_metadata cm
       WHERE cm.created_at IS NOT NULL
       GROUP BY day, cm.type
       ORDER BY day DESC
       LIMIT 60`,
    )
    .all() as Array<{
    day: string;
    type: string | null;
    count: number;
    cases: string | null;
  }>;

  let md = `---\ntype: hub\nscope: timeline\nauto_generated: true\nlast_updated: "${now}"\n---\n\n`;
  md += "# Timeline\n\n";

  if (recentActivity.length === 0) {
    md += "No activity recorded yet.\n\n";
    return md;
  }

  // Group by day
  const byDay = new Map<string, Array<{ type: string; count: number; cases: string | null }>>();
  for (const entry of recentActivity) {
    const day = entry.day;
    if (!byDay.has(day)) {
      byDay.set(day, []);
    }
    byDay.get(day)!.push({
      type: entry.type ?? "unknown",
      count: entry.count,
      cases: entry.cases,
    });
  }

  for (const [day, entries] of byDay) {
    md += `### ${day}\n\n`;
    for (const entry of entries) {
      const casesStr = entry.cases
        ? entry.cases
            .split(",")
            .filter(Boolean)
            .map((c) => `[[${c.trim()}]]`)
            .join(", ")
        : "";
      md += `- **${capitalizeFirst(entry.type)}** (${entry.count} entries)${casesStr ? ` — ${casesStr}` : ""}\n`;
    }
    md += "\n";
  }

  return md;
}

// ─── Helpers ───

type RawNodeRow = {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  created_at: string;
  updated_at: string;
  importance: number;
  status: string;
  confidence: number;
  memory_file: string | null;
  source: string | null;
  properties: string;
  valid_from: string | null;
  valid_to: string | null;
};

type RawNodeWithCount = RawNodeRow & { edge_count: number };

function getRelatedPeopleNames(db: DatabaseSync, nodeId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT n.name FROM nodes n
       JOIN edges e ON (n.id = e.from_node OR n.id = e.to_node)
       WHERE (e.from_node = ? OR e.to_node = ?) AND n.id != ? AND n.type = 'person'
       LIMIT 5`,
    )
    .all(nodeId, nodeId, nodeId) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function getRelatedCaseNames(db: DatabaseSync, nodeId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT n.name FROM nodes n
       JOIN edges e ON (n.id = e.from_node OR n.id = e.to_node)
       WHERE (e.from_node = ? OR e.to_node = ?) AND n.id != ? AND n.type = 'case' AND n.status = 'active'
       LIMIT 5`,
    )
    .all(nodeId, nodeId, nodeId) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function getChildKnowledgeNodes(db: DatabaseSync, nodeId: string): string[] {
  const rows = db
    .prepare(
      `SELECT n.name FROM nodes n
       JOIN edges e ON n.id = e.from_node
       WHERE e.to_node = ? AND e.relationship = 'child_of'
       ORDER BY n.name
       LIMIT 10`,
    )
    .all(nodeId) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function formatDate(isoDate: string): string {
  try {
    return isoDate.split("T")[0] ?? isoDate;
  } catch {
    return isoDate;
  }
}

function capitalizeFirst(str: string): string {
  if (!str) {
    return str;
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
}
