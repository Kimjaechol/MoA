/**
 * Vision Tool — unified MoA 4-layer vision system
 *
 * Actions:
 *   snapshot   — Layer 1: Accessibility tree snapshot
 *   document   — Layer 2: Parse .docx/.xlsx/.pptx
 *   screenshot — Layer 3: Smart screenshot with diff detection
 *   pdf        — Layer 4: PDF text extraction + optional rendering
 *   convert    — Document conversion: PDF/Office → HTML/Markdown/Editor
 *   auto       — Orchestrator: runs all relevant layers automatically
 */

import { Type } from "@sinclair/typebox";
import path from "node:path";
import type { OpenClawConfig } from "../../../config/config.js";
import type { AnyAgentTool } from "../common.js";
import { assertSandboxPath } from "../../sandbox-paths.js";
import { jsonResult, readStringParam, readNumberParam, imageResult } from "../common.js";
import { convertDocument, type ConvertOutputFormat } from "./converter/index.js";
import { captureAccessibilitySnapshot } from "./layer1-accessibility.js";
import { parseDocument } from "./layer2-document.js";
import { captureSmartScreenshot } from "./layer3-screenshot.js";
import { renderPdf } from "./layer4-pdf.js";
import { orchestrateVision, type VisionLayerName } from "./orchestrator.js";

export type { VisionResult } from "./types.js";
export type { DocumentConvertResult } from "./types.js";

export function createVisionTool(options?: {
  config?: OpenClawConfig;
  sandboxBrowserBridgeUrl?: string;
  agentDir?: string;
  sandboxRoot?: string;
}): AnyAgentTool | null {
  // Vision tool is always available — individual layers fail gracefully
  const browserBaseUrl = options?.sandboxBrowserBridgeUrl;
  const sandboxRoot = options?.sandboxRoot;

  return {
    label: "Vision",
    name: "vision",
    description: [
      "4-layer vision system for inspecting UI, documents, screenshots, and PDFs.",
      "",
      "Actions:",
      '  "snapshot"   — Capture accessibility tree of the active browser page.',
      '  "document"   — Parse an Office document (.docx/.xlsx/.pptx/.hwpx) and extract text.',
      '  "screenshot" — Capture a smart screenshot with change detection.',
      '  "pdf"        — Extract text from a PDF (digital + scanned/image PDF auto-detection).',
      '  "convert"    — Convert document (PDF/Office) to HTML, Markdown, or interactive editor.',
      '  "auto"       — Automatically run all relevant layers based on provided params.',
      "",
      "Parameters:",
      "  action (required): one of snapshot, document, screenshot, pdf, convert, auto",
      "  file: file path (required for document and pdf actions)",
      "  target_id: browser tab/target ID",
      "  profile: browser profile name",
      "  interactive: only show interactive elements (snapshot action)",
      "  full_page: capture full page screenshot (screenshot action)",
      "  ref: element reference for targeted screenshot",
      "  render_images: render PDF pages as images (pdf action; auto for scanned PDFs)",
      "  max_pages: max PDF pages to process",
      "  force_scanned: force scanned/image PDF mode for OCR (pdf action)",
      "  output_format: conversion output format — html, markdown, editor (convert action)",
      "  output_path: save converted file to this path (convert action)",
      "  editor_theme: light or dark theme for editor output (convert action)",
      "  layers: comma-separated layer names for auto action (e.g. accessibility,screenshot)",
      "",
      "Supported document types: .docx, .xlsx, .pptx, .hwpx",
      "  .hwp files are detected with a conversion notice to .hwpx",
      "",
      "Scanned PDF: auto-detected and rendered as high-res images for vision model OCR.",
      "  The result includes layout recognition guidance (headers, tables, columns).",
      "",
      "Convert action: Converts PDF/Office documents to styled HTML/Markdown/Editor.",
      '  output_format "html" — styled HTML preserving layout, fonts, tables, alignment.',
      '  output_format "markdown" — GFM Markdown with tables, headings, formatting.',
      '  output_format "editor" — self-contained HTML editor (WYSIWYG, save/export).',
    ].join("\n"),
    parameters: Type.Object({
      action: Type.String(),
      file: Type.Optional(Type.String()),
      target_id: Type.Optional(Type.String()),
      profile: Type.Optional(Type.String()),
      interactive: Type.Optional(Type.Boolean()),
      full_page: Type.Optional(Type.Boolean()),
      ref: Type.Optional(Type.String()),
      render_images: Type.Optional(Type.Boolean()),
      max_pages: Type.Optional(Type.Number()),
      force_scanned: Type.Optional(Type.Boolean()),
      output_format: Type.Optional(Type.String()),
      output_path: Type.Optional(Type.String()),
      editor_theme: Type.Optional(Type.String()),
      layers: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, args) => {
      const params = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
      const action = readStringParam(params, "action", { required: true });
      const filePath = readStringParam(params, "file");
      const targetId = readStringParam(params, "target_id");
      const profile = readStringParam(params, "profile");
      const interactive = typeof params.interactive === "boolean" ? params.interactive : undefined;
      const fullPage = typeof params.full_page === "boolean" ? params.full_page : undefined;
      const ref = readStringParam(params, "ref");
      const renderImages =
        typeof params.render_images === "boolean" ? params.render_images : undefined;
      const maxPages = readNumberParam(params, "max_pages", { integer: true });
      const forceScanned =
        typeof params.force_scanned === "boolean" ? params.force_scanned : undefined;
      const outputFormat = readStringParam(params, "output_format");
      const outputPath = readStringParam(params, "output_path");
      const editorTheme = readStringParam(params, "editor_theme");
      const layersRaw = readStringParam(params, "layers");

      // Resolve file path within sandbox if needed
      let resolvedFile: string | undefined;
      if (filePath) {
        if (sandboxRoot) {
          const info = await assertSandboxPath({
            filePath,
            cwd: sandboxRoot,
            root: sandboxRoot,
          });
          resolvedFile = info.resolved;
        } else {
          resolvedFile = path.resolve(filePath);
        }
      }

      switch (action) {
        // ── Layer 1: Accessibility Snapshot ──
        case "snapshot": {
          const result = await captureAccessibilitySnapshot({
            browserBaseUrl,
            profile,
            targetId,
            interactive,
            compact: true,
          });
          return jsonResult({
            action: "snapshot",
            ...result,
          });
        }

        // ── Layer 2: Document Parser ──
        case "document": {
          if (!resolvedFile) {
            throw new Error("file parameter required for document action");
          }
          const result = await parseDocument(resolvedFile);

          // HWP 파일인 경우 변환 안내 포함
          if (result.warning) {
            return jsonResult({
              action: "document",
              warning: result.warning,
              type: result.type,
              text: result.text,
              pageCount: result.pageCount,
              metadata: result.metadata,
              imageCount: result.imageCount,
            });
          }

          return jsonResult({
            action: "document",
            ...result,
          });
        }

        // ── Layer 3: Smart Screenshot ──
        case "screenshot": {
          const result = await captureSmartScreenshot({
            browserBaseUrl,
            profile,
            targetId,
            fullPage,
            ref,
          });

          // Return the screenshot as an image result
          return await imageResult({
            label: "vision:screenshot",
            path: "screenshot.png",
            base64: result.base64,
            mimeType: result.mimeType,
            extraText: [
              `Screenshot captured: ${result.width}x${result.height}`,
              result.hasChanges ? "Changes detected since last capture." : "No changes detected.",
            ].join("\n"),
            details: {
              width: result.width,
              height: result.height,
              hasChanges: result.hasChanges,
              timestamp: result.timestamp,
            },
          });
        }

        // ── Layer 4: PDF Rendering ──
        case "pdf": {
          if (!resolvedFile) {
            throw new Error("file parameter required for pdf action");
          }
          const result = await renderPdf(resolvedFile, {
            maxPages,
            renderImages,
            forceScanned,
          });

          // Scanned PDF: return images with OCR guidance
          if (result.isScanned && result.pageImages && result.pageImages.length > 0) {
            const firstPage = result.pageImages[0];
            const scannedInfo = [
              `PDF: ${result.pageCount} page(s) — 스캔 문서 감지됨`,
              "",
              result.ocrGuidance ?? "",
              "",
              result.text.length > 0 ? `추출된 디지털 텍스트 (${result.text.length}자):` : "",
              result.text.slice(0, 3000),
              result.text.length > 3000 ? "\n... (텍스트 일부 생략)" : "",
            ]
              .filter(Boolean)
              .join("\n");

            return await imageResult({
              label: "vision:pdf-ocr",
              path: resolvedFile,
              base64: firstPage.base64,
              mimeType: firstPage.mimeType,
              extraText: scannedInfo,
              details: {
                pageCount: result.pageCount,
                isScanned: true,
                scannedPages: result.pageAnalysis?.filter((p) => p.isScanned).map((p) => p.page),
                digitalTextLength: result.text.length,
                pagesRendered: result.pageImages.length,
                pageImages: result.pageImages.map((img) => ({
                  page: img.page,
                  width: img.width,
                  height: img.height,
                })),
                layoutRegions: result.layoutRegions,
              },
            });
          }

          // Digital PDF with rendered images
          if (result.pageImages && result.pageImages.length > 0) {
            const firstPage = result.pageImages[0];
            return await imageResult({
              label: "vision:pdf",
              path: resolvedFile,
              base64: firstPage.base64,
              mimeType: firstPage.mimeType,
              extraText: [
                `PDF: ${result.pageCount} page(s)`,
                "",
                result.text.slice(0, 5000),
                result.text.length > 5000 ? "\n... (truncated)" : "",
              ].join("\n"),
              details: {
                pageCount: result.pageCount,
                isScanned: false,
                textLength: result.text.length,
                pagesRendered: result.pageImages.length,
              },
            });
          }

          // Digital PDF, text only
          return jsonResult({
            action: "pdf",
            pageCount: result.pageCount,
            isScanned: result.isScanned,
            text: result.text,
            ...(result.pageAnalysis ? { pageAnalysis: result.pageAnalysis } : {}),
          });
        }

        // ── Document Converter ──
        case "convert": {
          if (!resolvedFile) {
            throw new Error("file parameter required for convert action");
          }

          const format = (outputFormat ?? "html") as ConvertOutputFormat;
          if (!["html", "markdown", "editor"].includes(format)) {
            throw new Error(
              `Invalid output_format: "${format}". Use one of: html, markdown, editor`,
            );
          }

          // Resolve output path within sandbox if needed
          let resolvedOutputPath: string | undefined;
          if (outputPath) {
            if (sandboxRoot) {
              const info = await assertSandboxPath({
                filePath: outputPath,
                cwd: sandboxRoot,
                root: sandboxRoot,
              });
              resolvedOutputPath = info.resolved;
            } else {
              resolvedOutputPath = path.resolve(outputPath);
            }
          }

          const result = await convertDocument(resolvedFile, {
            format,
            maxPages,
            outputPath: resolvedOutputPath,
            editorTheme: editorTheme === "dark" ? "dark" : "light",
          });

          // Truncate content for JSON response (full content saved to file if outputPath given)
          const truncatedContent =
            result.content.length > 50_000
              ? result.content.slice(0, 50_000) + "\n\n... (내용이 50,000자를 초과하여 잘렸습니다)"
              : result.content;

          return jsonResult({
            action: "convert",
            format: result.format,
            sourceType: result.sourceType,
            pageCount: result.pageCount,
            isScanned: result.isScanned,
            contentLength: result.content.length,
            plainTextLength: result.plainText.length,
            savedTo: result.savedTo,
            content: truncatedContent,
          });
        }

        // ── Orchestrator: Auto ──
        case "auto": {
          const layers = layersRaw
            ? (layersRaw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean) as VisionLayerName[])
            : undefined;

          const result = await orchestrateVision({
            layers,
            browserBaseUrl,
            browserProfile: profile,
            targetId,
            interactive,
            compact: true,
            documentPath:
              resolvedFile && /\.(docx|xlsx|pptx|hwpx|hwp)$/i.test(resolvedFile)
                ? resolvedFile
                : undefined,
            fullPage,
            screenshotRef: ref,
            pdfPath: resolvedFile && /\.pdf$/i.test(resolvedFile) ? resolvedFile : undefined,
            maxPdfPages: maxPages,
            renderPdfImages: renderImages,
            forceScanned,
          });

          // If there's a screenshot, include it as image
          if (result.screenshot) {
            return await imageResult({
              label: "vision:auto",
              path: "vision-auto.png",
              base64: result.screenshot.base64,
              mimeType: result.screenshot.mimeType,
              extraText: result.summary,
              details: {
                layers: result.layers,
                accessibilityElements: result.accessibility?.elementCount,
                documentType: result.document?.type,
                documentChars: result.document?.text.length,
                screenshotSize: result.screenshot
                  ? `${result.screenshot.width}x${result.screenshot.height}`
                  : undefined,
                pdfPages: result.pdf?.pageCount,
              },
            });
          }

          return jsonResult({
            action: "auto",
            layers: result.layers,
            summary: result.summary,
            accessibility: result.accessibility
              ? {
                  elementCount: result.accessibility.elementCount,
                  activeWindow: result.accessibility.activeWindow,
                  tree: result.accessibility.tree.slice(0, 10000),
                }
              : undefined,
            document: result.document
              ? {
                  type: result.document.type,
                  pageCount: result.document.pageCount,
                  textLength: result.document.text.length,
                  text: result.document.text.slice(0, 10000),
                  metadata: result.document.metadata,
                }
              : undefined,
            pdf: result.pdf
              ? {
                  pageCount: result.pdf.pageCount,
                  textLength: result.pdf.text.length,
                  text: result.pdf.text.slice(0, 10000),
                }
              : undefined,
          });
        }

        default:
          throw new Error(
            `Unknown vision action: "${action}". Use one of: snapshot, document, screenshot, pdf, convert, auto`,
          );
      }
    },
  };
}
