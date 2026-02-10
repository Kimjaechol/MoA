/**
 * MoA Advanced Memory System - YAML Frontmatter & Obsidian Link Parser
 *
 * Parses YAML frontmatter from Markdown documents and extracts
 * Obsidian-style [[internal links]] for graph construction.
 */

import type { MemoryFrontmatter } from "./types.js";

// ─── YAML Frontmatter Parsing ───

/**
 * Extract YAML frontmatter from a markdown document.
 * Returns the parsed frontmatter and the remaining content body.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Partial<MemoryFrontmatter> | null;
  body: string;
} {
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
  const match = content.match(fmRegex);

  if (!match) {
    return { frontmatter: null, body: content };
  }

  const yamlBlock = match[1] ?? "";
  const body = match[2] ?? "";

  try {
    const parsed = parseSimpleYaml(yamlBlock);
    return { frontmatter: parsed as Partial<MemoryFrontmatter>, body };
  } catch {
    return { frontmatter: null, body: content };
  }
}

/**
 * Serialize frontmatter and body back to a markdown document.
 */
export function serializeFrontmatter(
  frontmatter: Partial<MemoryFrontmatter>,
  body: string,
): string {
  const yamlLines: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value == null) {
      continue;
    }
    yamlLines.push(serializeYamlValue(key, value));
  }

  if (yamlLines.length === 0) {
    return body;
  }

  return `---\n${yamlLines.join("\n")}\n---\n\n${body}`;
}

// ─── Obsidian Link Parsing ───

/** Parsed internal link: [[target|display]] or [[target]] */
export type InternalLink = {
  target: string;
  display?: string;
  raw: string;
};

/**
 * Extract all [[internal links]] from markdown content.
 */
export function extractInternalLinks(content: string): InternalLink[] {
  const linkRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
  const links: InternalLink[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(linkRegex)) {
    const target = match[1]?.trim() ?? "";
    const display = match[2]?.trim();
    const raw = match[0];

    if (target && !seen.has(target)) {
      seen.add(target);
      links.push({ target, display, raw });
    }
  }

  return links;
}

/**
 * Extract external links (markdown-style) from content.
 */
export function extractExternalLinks(content: string): Array<{ url: string; title: string }> {
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const links: Array<{ url: string; title: string }> = [];

  for (const match of content.matchAll(linkRegex)) {
    links.push({
      title: match[1] ?? "",
      url: match[2] ?? "",
    });
  }

  return links;
}

/**
 * Generate [[internal links]] for entities found in content.
 * Wraps entity names with [[]] if not already linked.
 */
export function autoLinkEntities(content: string, entityNames: string[]): string {
  let result = content;

  for (const name of entityNames) {
    // Skip if already linked
    if (result.includes(`[[${name}]]`) || result.includes(`[[${name}|`)) {
      continue;
    }

    // Only link the first occurrence
    // Use lookaround that works with Unicode/Korean (no \b for CJK)
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?<!\\[\\[)${escaped}(?!\\]\\])`, "");
    result = result.replace(regex, `[[${name}]]`);
  }

  return result;
}

// ─── Simple YAML Parser ───
// Lightweight YAML parser that handles the subset we use in frontmatter.
// Avoids requiring a full YAML library.

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentKey = "";
  let currentArray: unknown[] | null = null;
  let currentObject: Record<string, unknown> | null = null;

  for (const line of lines) {
    // Skip empty lines and comments
    if (line.trim() === "" || line.trim().startsWith("#")) {
      continue;
    }

    // Array item under a key
    if (/^\s+-\s+/.test(line) && currentKey) {
      const value = line.replace(/^\s+-\s+/, "").trim();
      if (!currentArray) {
        currentArray = [];
        result[currentKey] = currentArray;
      }

      // Check for nested object in array item (e.g., "- url: ...")
      if (value.includes(": ")) {
        const objValue = parseInlineObject(value);
        currentArray.push(objValue);
      } else {
        currentArray.push(parseYamlScalar(value));
      }
      continue;
    }

    // Nested key-value under an object key
    if (/^\s{2,}\w/.test(line) && currentKey && currentObject) {
      const match = line.match(/^\s+(\w[\w-]*)\s*:\s*(.*)/);
      if (match?.[1]) {
        (currentObject as Record<string, unknown>)[match[1]] = parseYamlScalar(
          match[2]?.trim() ?? "",
        );
      }
      continue;
    }

    // Top-level key-value
    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2]?.trim() ?? "";
      currentKey = key;
      currentArray = null;
      currentObject = null;

      if (value === "") {
        // Could be start of array or nested object
        continue;
      }

      // Inline array: [a, b, c]
      if (value.startsWith("[") && value.endsWith("]")) {
        result[key] = parseInlineArray(value);
        continue;
      }

      result[key] = parseYamlScalar(value);
    }
  }

  return result;
}

function parseYamlScalar(value: string): unknown {
  // Remove quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  // Null
  if (value === "null" || value === "~") {
    return null;
  }

  // Number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function parseInlineArray(value: string): unknown[] {
  const inner = value.slice(1, -1).trim();
  if (!inner) {
    return [];
  }
  return inner.split(",").map((item) => parseYamlScalar(item.trim()));
}

function parseInlineObject(value: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // Simple key: value pairs separated by commas
  const parts = value.split(",");
  for (const part of parts) {
    const kvMatch = part.match(/(\w[\w-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      result[kvMatch[1]] = parseYamlScalar(kvMatch[2]?.trim() ?? "");
    }
  }
  return result;
}

function serializeYamlValue(key: string, value: unknown, indent = 0): string {
  const prefix = " ".repeat(indent);

  if (typeof value === "string") {
    // Quote strings that contain special characters
    if (value.includes(":") || value.includes("#") || value.includes("[") || value.includes('"')) {
      return `${prefix}${key}: "${value.replace(/"/g, '\\"')}"`;
    }
    return `${prefix}${key}: ${value}`;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${prefix}${key}: ${value}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${prefix}${key}: []`;
    }
    // Check if items are simple scalars
    const allSimple = value.every(
      (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    );
    if (allSimple && value.length <= 5) {
      // Inline array for short lists
      const items = value.map((v) => (typeof v === "string" ? `"${v}"` : String(v)));
      return `${prefix}${key}: [${items.join(", ")}]`;
    }
    // Multi-line array
    const lines = [`${prefix}${key}:`];
    for (const item of value) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const objEntries = Object.entries(item as Record<string, unknown>);
        if (objEntries.length > 0) {
          const [firstKey, firstVal] = objEntries[0];
          lines.push(`${prefix}  - ${firstKey}: ${String(firstVal)}`);
          for (const [k, v] of objEntries.slice(1)) {
            lines.push(`${prefix}    ${k}: ${String(v)}`);
          }
        }
      } else {
        lines.push(`${prefix}  - ${String(item)}`);
      }
    }
    return lines.join("\n");
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return `${prefix}${key}: {}`;
    }
    const lines = [`${prefix}${key}:`];
    for (const [k, v] of entries) {
      lines.push(serializeYamlValue(k, v, indent + 2));
    }
    return lines.join("\n");
  }

  return `${prefix}${key}: ${String(value)}`;
}
