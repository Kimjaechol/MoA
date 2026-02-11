/**
 * Vision System Orchestrator
 *
 * Coordinates the 4 vision layers and combines results into a unified
 * VisionResult.  Each layer runs independently and may fail gracefully
 * without blocking the others.
 */

import type { VisionResult } from "./types.js";
import { logWarn } from "../../../logger.js";
import { captureAccessibilitySnapshot, type AccessibilityOptions } from "./layer1-accessibility.js";
import { parseDocument, type DocumentParseOptions } from "./layer2-document.js";
import { captureSmartScreenshot, type ScreenshotOptions } from "./layer3-screenshot.js";
import { renderPdf, type PdfRenderOptions } from "./layer4-pdf.js";

export type VisionLayerName = "accessibility" | "document" | "screenshot" | "pdf";

export interface VisionOrchestrationOptions {
  /** Which layers to run.  Defaults to all available layers. */
  layers?: VisionLayerName[];

  // ── Layer 1 ──
  browserBaseUrl?: string;
  browserProfile?: string;
  targetId?: string;
  interactive?: boolean;
  compact?: boolean;
  maxDepth?: number;

  // ── Layer 2 ──
  documentPath?: string;
  maxDocumentChars?: number;

  // ── Layer 3 ──
  fullPage?: boolean;
  screenshotRef?: string;
  maxSide?: number;
  maxBytes?: number;
  screenshotCacheKey?: string;

  // ── Layer 4 ──
  pdfPath?: string;
  maxPdfPages?: number;
  renderPdfImages?: boolean;
  maxPdfPixels?: number;
  forceScanned?: boolean;
}

/** Build a human-readable summary from the collected results. */
function buildSummary(result: VisionResult): string {
  const parts: string[] = [];

  if (result.accessibility) {
    const a = result.accessibility;
    parts.push(
      `[Accessibility] ${a.elementCount} elements found` +
        (a.activeWindow ? ` on "${a.activeWindow}"` : ""),
    );
  }

  if (result.document) {
    const d = result.document;
    if (d.warning) {
      parts.push(`[Document] ${d.warning}`);
    } else {
      parts.push(
        `[Document] ${d.type.toUpperCase()} — ${d.pageCount} page(s), ` +
          `${d.text.length} chars extracted, ${d.imageCount} image(s)`,
      );
    }
  }

  if (result.screenshot) {
    const s = result.screenshot;
    parts.push(
      `[Screenshot] ${s.width}x${s.height} (${s.mimeType})` +
        (s.hasChanges ? " — changes detected" : " — no changes"),
    );
  }

  if (result.pdf) {
    const p = result.pdf;
    const scannedLabel = p.isScanned ? " (스캔 문서)" : "";
    parts.push(
      `[PDF${scannedLabel}] ${p.pageCount} page(s), ${p.text.length} chars extracted` +
        (p.pageImages ? `, ${p.pageImages.length} page image(s) rendered` : ""),
    );
    if (p.ocrGuidance) {
      parts.push(p.ocrGuidance);
    }
  }

  if (parts.length === 0) {
    return "No vision layers produced results.";
  }

  return parts.join("\n");
}

/**
 * Run one or more vision layers and combine results.
 *
 * Each requested layer runs concurrently.  A layer failure is logged
 * but does not prevent other layers from completing.
 */
export async function orchestrateVision(opts: VisionOrchestrationOptions): Promise<VisionResult> {
  const requestedLayers = opts.layers ?? inferLayers(opts);
  const result: VisionResult = {
    layers: [],
    summary: "",
  };

  const tasks: Array<Promise<void>> = [];

  // ── Layer 1: Accessibility ──
  if (requestedLayers.includes("accessibility")) {
    tasks.push(
      (async () => {
        try {
          const accessibilityOpts: AccessibilityOptions = {
            browserBaseUrl: opts.browserBaseUrl,
            profile: opts.browserProfile,
            targetId: opts.targetId,
            interactive: opts.interactive,
            compact: opts.compact,
            maxDepth: opts.maxDepth,
          };
          result.accessibility = await captureAccessibilitySnapshot(accessibilityOpts);
          result.layers.push("accessibility");
        } catch (err) {
          logWarn(`vision: Layer 1 (accessibility) failed: ${String(err)}`);
        }
      })(),
    );
  }

  // ── Layer 2: Document ──
  if (requestedLayers.includes("document") && opts.documentPath) {
    tasks.push(
      (async () => {
        try {
          const docOpts: DocumentParseOptions = {
            maxChars: opts.maxDocumentChars,
          };
          result.document = await parseDocument(opts.documentPath!, docOpts);
          result.layers.push("document");
        } catch (err) {
          logWarn(`vision: Layer 2 (document) failed: ${String(err)}`);
        }
      })(),
    );
  }

  // ── Layer 3: Screenshot ──
  if (requestedLayers.includes("screenshot")) {
    tasks.push(
      (async () => {
        try {
          const ssOpts: ScreenshotOptions = {
            browserBaseUrl: opts.browserBaseUrl,
            profile: opts.browserProfile,
            targetId: opts.targetId,
            fullPage: opts.fullPage,
            ref: opts.screenshotRef,
            maxSide: opts.maxSide,
            maxBytes: opts.maxBytes,
            cacheKey: opts.screenshotCacheKey,
          };
          result.screenshot = await captureSmartScreenshot(ssOpts);
          result.layers.push("screenshot");
        } catch (err) {
          logWarn(`vision: Layer 3 (screenshot) failed: ${String(err)}`);
        }
      })(),
    );
  }

  // ── Layer 4: PDF ──
  if (requestedLayers.includes("pdf") && opts.pdfPath) {
    tasks.push(
      (async () => {
        try {
          const pdfOpts: PdfRenderOptions = {
            maxPages: opts.maxPdfPages,
            renderImages: opts.renderPdfImages,
            maxPixelsPerPage: opts.maxPdfPixels,
            forceScanned: opts.forceScanned,
          };
          result.pdf = await renderPdf(opts.pdfPath!, pdfOpts);
          result.layers.push("pdf");
        } catch (err) {
          logWarn(`vision: Layer 4 (pdf) failed: ${String(err)}`);
        }
      })(),
    );
  }

  await Promise.all(tasks);
  result.summary = buildSummary(result);
  return result;
}

/**
 * Infer which layers to run based on provided options.
 */
function inferLayers(opts: VisionOrchestrationOptions): VisionLayerName[] {
  const layers: VisionLayerName[] = [];

  // Always try accessibility if browser URL is present
  if (opts.browserBaseUrl) {
    layers.push("accessibility");
    layers.push("screenshot");
  }

  // Document layer if a document path is provided
  if (opts.documentPath) {
    layers.push("document");
  }

  // PDF layer if a PDF path is provided
  if (opts.pdfPath) {
    layers.push("pdf");
  }

  // Default: at least try accessibility + screenshot
  if (layers.length === 0) {
    layers.push("accessibility", "screenshot");
  }

  return layers;
}
