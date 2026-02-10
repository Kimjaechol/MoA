/**
 * MoA Advanced Memory v2 — Frontmatter & Link Parser
 *
 * Parses YAML frontmatter from Markdown files and extracts [[internal links]].
 * No external YAML dependency — uses a lightweight custom parser.
 */

import type { PersonEntry, ExtractedMetadata } from "./types.js";

// ─── YAML Frontmatter Parsing ───

export interface ParsedFrontmatter {
  [key: string]: unknown;
}

/**
 * Extract YAML frontmatter from a Markdown document.
 * Returns the parsed metadata and the body text (without frontmatter).
 */
export function parseFrontmatter(content: string): {
  frontmatter: ParsedFrontmatter;
  body: string;
} {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = trimmed.slice(4, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trim();

  return {
    frontmatter: parseSimpleYaml(yamlBlock),
    body,
  };
}

/**
 * Serialize frontmatter and body back to a Markdown document.
 */
export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }

      // Check if items are objects (people entries)
      if (typeof value[0] === "object" && value[0] !== null) {
        lines.push(`${key}:`);
        for (const item of value) {
          const obj = item as Record<string, unknown>;
          const entries = Object.entries(obj);
          if (entries.length > 0) {
            const [firstKey, firstVal] = entries[0];
            lines.push(`  - ${firstKey}: ${formatYamlValue(firstVal)}`);
            for (let i = 1; i < entries.length; i++) {
              lines.push(`    ${entries[i][0]}: ${formatYamlValue(entries[i][1])}`);
            }
          }
        }
      } else {
        // Simple array: tags, etc.
        const formatted = value.map((v) => String(v));
        lines.push(`${key}: [${formatted.join(", ")}]`);
      }
    } else if (typeof value === "object") {
      lines.push(`${key}:`);
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        if (subVal !== undefined && subVal !== null) {
          lines.push(`  ${subKey}: ${formatYamlValue(subVal)}`);
        }
      }
    } else {
      lines.push(`${key}: ${formatYamlValue(value)}`);
    }
  }

  lines.push("---");
  return lines.join("\n") + "\n\n" + body;
}

function formatYamlValue(value: unknown): string {
  if (typeof value === "string") {
    // Quote if contains special chars
    if (/[:#[]{},|>&*!?]/.test(value) || value.includes("\n")) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}

// ─── Internal Link Extraction ───

/** Extract [[target|display]] links from Markdown content */
export function extractInternalLinks(content: string): Array<{
  target: string;
  display?: string;
  position: number;
}> {
  const links: Array<{ target: string; display?: string; position: number }> = [];
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    links.push({
      target: match[1].trim(),
      display: match[2]?.trim(),
      position: match.index,
    });
  }

  return links;
}

/** Extract link target names only (deduped) */
export function extractLinkTargets(content: string): string[] {
  const links = extractInternalLinks(content);
  return [...new Set(links.map((l) => l.target))];
}

/**
 * Auto-link entity names in text with [[]] markers.
 * Works with Korean/CJK characters (no \\b word boundary).
 */
export function autoLinkEntities(text: string, entityNames: string[]): string {
  let result = text;
  // Sort by length descending to avoid partial matches
  const sorted = [...entityNames].toSorted((a, b) => b.length - a.length);

  for (const name of sorted) {
    if (result.includes(`[[${name}]]`) || result.includes(`[[${name}|`)) {
      continue;
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<!\\[\\[)${escaped}(?!\\]\\])`, "");
    result = result.replace(regex, `[[${name}]]`);
  }

  return result;
}

// ─── Metadata Extraction from Frontmatter ───

/** Convert parsed frontmatter to ExtractedMetadata */
export function frontmatterToMetadata(fm: ParsedFrontmatter): Partial<ExtractedMetadata> {
  const result: Partial<ExtractedMetadata> = {};

  if (typeof fm.type === "string") {
    result.type = fm.type as ExtractedMetadata["type"];
  }
  if (typeof fm.place === "string") {
    result.place = fm.place;
  }
  if (typeof fm.case === "string") {
    result.caseRef = fm.case;
  }
  if (typeof fm.emotion === "string") {
    result.emotion = fm.emotion as ExtractedMetadata["emotion"];
  }
  if (typeof fm.emotion_raw === "string") {
    result.emotionRaw = fm.emotion_raw;
  }
  if (typeof fm.domain === "string") {
    result.domain = fm.domain as ExtractedMetadata["domain"];
  }
  if (typeof fm.status === "string") {
    result.status = fm.status as ExtractedMetadata["status"];
  }
  if (typeof fm.importance === "number") {
    result.importance = fm.importance;
  }
  if (typeof fm.deadline === "string") {
    result.deadline = fm.deadline;
  }

  // Parse tags
  if (Array.isArray(fm.tags)) {
    result.tags = fm.tags.filter((t): t is string => typeof t === "string");
  }

  // Parse people (with identifier support)
  if (Array.isArray(fm.people)) {
    result.people = fm.people
      .map((p): PersonEntry | null => {
        if (typeof p === "string") {
          return { name: p };
        }
        if (typeof p === "object" && p !== null) {
          const obj = p as Record<string, unknown>;
          if (typeof obj.name === "string") {
            return {
              name: obj.name,
              identifier: typeof obj.identifier === "string" ? obj.identifier : undefined,
            };
          }
        }
        return null;
      })
      .filter((p): p is PersonEntry => p !== null);
  }

  return result;
}

// ─── Simple YAML Parser ───

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentKey = "";
  let currentArray: unknown[] | null = null;

  for (const line of lines) {
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }

    // Array item
    if (/^\s+-\s+/.test(line) && currentKey) {
      const value = line.replace(/^\s+-\s+/, "").trim();
      if (!currentArray) {
        currentArray = [];
        result[currentKey] = currentArray;
      }
      if (value.includes(": ")) {
        currentArray.push(parseInlineObject(value));
      } else {
        currentArray.push(parseYamlScalar(value));
      }
      continue;
    }

    // Nested key-value under array item
    if (/^\s{4,}\w/.test(line) && currentKey && currentArray) {
      const match = line.match(/^\s+(\w[\w-]*)\s*:\s*(.*)/);
      if (match?.[1] && currentArray.length > 0) {
        const lastItem = currentArray[currentArray.length - 1];
        if (typeof lastItem === "object" && lastItem !== null) {
          (lastItem as Record<string, unknown>)[match[1]] = parseYamlScalar(match[2]?.trim() ?? "");
        }
      }
      continue;
    }

    // Top-level key-value
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (kvMatch?.[1]) {
      const key = kvMatch[1];
      const value = kvMatch[2]?.trim() ?? "";
      currentKey = key;
      currentArray = null;

      if (value === "") {
        continue;
      }

      if (value.startsWith("[") && value.endsWith("]")) {
        result[key] = parseInlineArray(value);
      } else {
        result[key] = parseYamlScalar(value);
      }
    }
  }

  return result;
}

function parseInlineArray(value: string): unknown[] {
  const inner = value.slice(1, -1);
  if (inner.trim() === "") {
    return [];
  }
  return inner.split(",").map((s) => parseYamlScalar(s.trim()));
}

function parseInlineObject(value: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const parts = value.split(/,\s*/);
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx > 0) {
      const k = part.slice(0, colonIdx).trim();
      const v = part.slice(colonIdx + 1).trim();
      result[k] = parseYamlScalar(v);
    }
  }
  return result;
}

function parseYamlScalar(value: string): string | number | boolean | null {
  if (value === "null" || value === "~" || value === "") {
    return null;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value);
  }
  // Strip quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
