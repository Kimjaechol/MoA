/**
 * Layer 3: Smart screenshot with diff-based change detection
 *
 * Captures a screenshot via the browser bridge and compares it to
 * the previous capture to detect visual changes.  When no browser is
 * available, it can also capture OS-level screenshots through native
 * commands (screencapture on macOS, import on Linux, etc.).
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { SmartScreenshotResult } from "./types.js";
import { browserScreenshotAction } from "../../../browser/client-actions-core.js";
import { normalizeBrowserScreenshot } from "../../../browser/screenshot.js";
import { getImageMetadata } from "../../../media/image-ops.js";

/** In-memory cache of the last screenshot per key for diff comparison. */
const lastScreenshotCache = new Map<string, Buffer>();

export interface ScreenshotOptions {
  /** Browser bridge base URL. */
  browserBaseUrl?: string;
  /** Browser profile to target. */
  profile?: string;
  /** Target tab/page ID. */
  targetId?: string;
  /** Capture full page (not just viewport). */
  fullPage?: boolean;
  /** Specific element reference to capture. */
  ref?: string;
  /** Max side length for the output image. */
  maxSide?: number;
  /** Max bytes for the output image. */
  maxBytes?: number;
  /** Cache key for diff tracking (defaults to profile or "default"). */
  cacheKey?: string;
}

/**
 * Compare two buffers pixel-by-pixel (simplified) to detect if changes occurred.
 * Returns true if the buffers differ in content.
 */
function buffersAreDifferent(a: Buffer, b: Buffer): boolean {
  if (a.byteLength !== b.byteLength) return true;
  // Compare in 4KB chunks for performance
  const chunkSize = 4096;
  for (let i = 0; i < a.byteLength; i += chunkSize) {
    const end = Math.min(i + chunkSize, a.byteLength);
    const sliceA = a.subarray(i, end);
    const sliceB = b.subarray(i, end);
    if (!sliceA.equals(sliceB)) return true;
  }
  return false;
}

/**
 * Capture a smart screenshot that tracks changes between captures.
 */
export async function captureSmartScreenshot(
  opts: ScreenshotOptions,
): Promise<SmartScreenshotResult> {
  const baseUrl = opts.browserBaseUrl;

  // Capture screenshot via browser bridge
  const result = await browserScreenshotAction(baseUrl, {
    targetId: opts.targetId,
    fullPage: opts.fullPage ?? false,
    ref: opts.ref,
    type: "png",
    profile: opts.profile,
  });

  if (!result.ok || !result.path) {
    throw new Error("Screenshot capture failed");
  }

  // Read the screenshot file
  const rawBuffer = await fs.readFile(result.path);

  // Normalize (resize/compress if too large)
  const normalized = await normalizeBrowserScreenshot(rawBuffer, {
    maxSide: opts.maxSide,
    maxBytes: opts.maxBytes,
  });
  const buffer = Buffer.from(normalized.buffer);
  const mimeType = normalized.contentType ?? "image/png";

  // Get dimensions
  const meta = await getImageMetadata(buffer);
  const width = meta?.width ?? 0;
  const height = meta?.height ?? 0;

  // Diff detection against last capture
  const cacheKey = opts.cacheKey ?? opts.profile ?? "default";
  const lastBuffer = lastScreenshotCache.get(cacheKey);
  const hasChanges = lastBuffer ? buffersAreDifferent(lastBuffer, buffer) : true;

  // Update cache
  lastScreenshotCache.set(cacheKey, buffer);

  // Clean up the temp file
  try {
    await fs.unlink(result.path);
  } catch {
    // Ignore cleanup failures
  }

  return {
    base64: buffer.toString("base64"),
    mimeType,
    width,
    height,
    hasChanges,
    timestamp: new Date().toISOString(),
  };
}

/** Clear the screenshot cache (useful for testing). */
export function clearScreenshotCache(): void {
  lastScreenshotCache.clear();
}
