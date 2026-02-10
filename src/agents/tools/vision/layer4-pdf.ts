/**
 * Layer 4: PDF rendering — text extraction + optional page image rendering
 *
 * Re-uses the existing pdfjs-dist infrastructure from input-files.ts
 * to extract text from PDF files and optionally render pages as images
 * for visual verification.
 */

import fs from "node:fs/promises";
import type { PdfRenderResult } from "./types.js";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type CanvasModule = typeof import("@napi-rs/canvas");

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
let canvasModulePromise: Promise<CanvasModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs").catch((err) => {
      pdfJsModulePromise = null;
      throw new Error(`pdfjs-dist required for PDF rendering: ${String(err)}`);
    });
  }
  return pdfJsModulePromise;
}

async function loadCanvas(): Promise<CanvasModule> {
  if (!canvasModulePromise) {
    canvasModulePromise = import("@napi-rs/canvas").catch((err) => {
      canvasModulePromise = null;
      throw new Error(`@napi-rs/canvas required for PDF page images: ${String(err)}`);
    });
  }
  return canvasModulePromise;
}

export interface PdfRenderOptions {
  /** Maximum number of pages to process. */
  maxPages?: number;
  /** Whether to render pages as images. */
  renderImages?: boolean;
  /** Max pixels per page image (width * height budget). */
  maxPixelsPerPage?: number;
}

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_PIXELS = 4_000_000;

/**
 * Extract text from a PDF file and optionally render pages as images.
 */
export async function renderPdf(
  filePath: string,
  opts?: PdfRenderOptions,
): Promise<PdfRenderResult> {
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  const renderImages = opts?.renderImages ?? false;
  const maxPixels = opts?.maxPixelsPerPage ?? DEFAULT_MAX_PIXELS;

  const buffer = await fs.readFile(filePath);
  const { getDocument } = await loadPdfJs();
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
  }).promise;

  const pagesToProcess = Math.min(pdf.numPages, maxPages);
  const textParts: string[] = [];

  // Extract text from all pages
  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .filter(Boolean)
      .join(" ");
    if (pageText.trim()) {
      textParts.push(`[Page ${pageNum}]\n${pageText.trim()}`);
    }
  }

  const text = textParts.join("\n\n");

  // Optionally render page images
  let pageImages: PdfRenderResult["pageImages"];
  if (renderImages) {
    try {
      const { createCanvas } = await loadCanvas();
      pageImages = [];

      for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const pagePixels = viewport.width * viewport.height;
        const scale = Math.min(1, Math.sqrt(maxPixels / pagePixels));
        const scaled = page.getViewport({ scale: Math.max(0.1, scale) });

        const canvas = createCanvas(Math.ceil(scaled.width), Math.ceil(scaled.height));
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport: scaled,
        }).promise;

        const png = canvas.toBuffer("image/png");
        pageImages.push({
          page: pageNum,
          base64: png.toString("base64"),
          mimeType: "image/png",
        });
      }
    } catch {
      // If canvas is not available, skip image rendering gracefully
      pageImages = undefined;
    }
  }

  return {
    text,
    pageCount: pdf.numPages,
    pageImages,
  };
}
