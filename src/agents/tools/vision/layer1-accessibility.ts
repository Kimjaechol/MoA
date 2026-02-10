/**
 * Layer 1: Accessibility API — UI tree reader
 *
 * Uses Playwright's accessibility snapshot (via the browser bridge) to read
 * the structured UI tree of the active page.  Falls back gracefully when
 * the browser bridge is not available.
 */

import type { AccessibilitySnapshot } from "./types.js";
import { browserSnapshot } from "../../../browser/client.js";
import {
  buildRoleSnapshotFromAiSnapshot,
  getRoleSnapshotStats,
} from "../../../browser/pw-role-snapshot.js";

export interface AccessibilityOptions {
  /** Browser bridge base URL (e.g. http://localhost:9222). */
  browserBaseUrl?: string;
  /** Browser profile to target. */
  profile?: string;
  /** Specific tab/target ID. */
  targetId?: string;
  /** Only include interactive elements. */
  interactive?: boolean;
  /** Compact mode — remove unnamed structural elements. */
  compact?: boolean;
  /** Maximum tree depth. */
  maxDepth?: number;
}

/**
 * Capture an accessibility snapshot of the currently active browser page.
 *
 * Returns a structured tree representation via Playwright's AI snapshot
 * format, enriched with role-refs for actionable elements.
 */
export async function captureAccessibilitySnapshot(
  opts: AccessibilityOptions,
): Promise<AccessibilitySnapshot> {
  const baseUrl = opts.browserBaseUrl;

  const result = await browserSnapshot(baseUrl, {
    format: "ai",
    targetId: opts.targetId,
    refs: "aria",
    interactive: opts.interactive ?? false,
    compact: opts.compact ?? true,
    depth: opts.maxDepth,
    profile: opts.profile,
  });

  if (!result.ok || result.format !== "ai") {
    throw new Error("Accessibility snapshot failed: unexpected response format");
  }

  // Enrich snapshot with role refs for element counting
  const { snapshot: enrichedTree, refs } = buildRoleSnapshotFromAiSnapshot(result.snapshot, {
    interactive: opts.interactive,
    maxDepth: opts.maxDepth,
    compact: opts.compact ?? true,
  });

  const stats = getRoleSnapshotStats(enrichedTree, refs);

  return {
    tree: enrichedTree,
    elementCount: stats.refs,
    focusedElement: undefined,
    activeWindow: result.url,
    timestamp: new Date().toISOString(),
  };
}
