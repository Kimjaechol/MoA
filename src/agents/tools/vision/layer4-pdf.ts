/**
 * Layer 4: PDF rendering — digital + scanned/image PDF support
 *
 * Handles two categories of PDFs:
 *   1. Digital PDF (텍스트 기반): pdfjs-dist로 텍스트를 직접 추출
 *   2. Scanned/Image PDF (이미지 기반): 자동 감지 후 고품질 페이지 이미지를
 *      렌더링하여 비전 모델(Claude, GPT-4V 등)이 OCR 수행 가능하도록 제공
 *
 * 스캔 PDF 감지 기준: 페이지당 평균 텍스트가 MIN_TEXT_PER_PAGE 미만이면
 * 이미지 기반으로 판정하고, 자동으로 고해상도 페이지 이미지를 렌더링합니다.
 */

import fs from "node:fs/promises";
import type { PdfLayoutRegion, PdfPageTextInfo, PdfRenderResult } from "./types.js";

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
  /** Whether to render pages as images (forced true for scanned PDFs). */
  renderImages?: boolean;
  /** Max pixels per page image (width * height budget). */
  maxPixelsPerPage?: number;
  /** DPI scale for scanned PDF rendering (higher = better OCR quality). Default 2.0. */
  ocrDpiScale?: number;
  /** Force scanned mode (skip auto-detection). */
  forceScanned?: boolean;
}

/** Minimum average chars per page to consider a PDF as text-based. */
const MIN_TEXT_PER_PAGE = 50;
/** Default max pages. */
const DEFAULT_MAX_PAGES = 20;
/** Default pixel budget for digital PDF page images. */
const DEFAULT_MAX_PIXELS = 4_000_000;
/** Higher pixel budget for scanned PDFs (OCR needs more detail). */
const SCANNED_MAX_PIXELS = 8_000_000;
/** Default DPI scale for scanned PDF rendering. */
const DEFAULT_OCR_DPI_SCALE = 2.0;

/**
 * Analyze a PDF page's operator list to detect image-based content.
 * Returns layout regions found on the page.
 */
async function analyzePageLayout(
  page: { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }> },
  pageNum: number,
  viewport: { width: number; height: number },
): Promise<PdfLayoutRegion[]> {
  const regions: PdfLayoutRegion[] = [];

  try {
    const opList = await page.getOperatorList();
    // OPS constants from pdfjs-dist
    // paintImageXObject = 85, paintJpegXObject = 82
    const imageOps = new Set([82, 85]);
    let imageCount = 0;

    for (let i = 0; i < opList.fnArray.length; i++) {
      if (imageOps.has(opList.fnArray[i])) {
        imageCount++;
      }
    }

    if (imageCount > 0) {
      // Large images spanning most of the page suggest a scanned document
      regions.push({
        type: "image",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        page: pageNum,
      });
    }
  } catch {
    // Operator list analysis is best-effort
  }

  return regions;
}

/**
 * Generate OCR guidance text for scanned PDFs.
 */
function buildOcrGuidance(pageAnalysis: PdfPageTextInfo[], totalPages: number): string {
  const scannedPages = pageAnalysis.filter((p) => p.isScanned);
  const scannedCount = scannedPages.length;

  if (scannedCount === 0) return "";

  const lines = [
    `[스캔 문서 감지] 이 PDF의 ${scannedCount}/${totalPages} 페이지가 이미지 기반(스캔)으로 감지되었습니다.`,
    "",
    "자동으로 고해상도 페이지 이미지가 렌더링되었습니다.",
    "각 페이지 이미지를 분석하여 텍스트와 레이아웃을 읽어주세요.",
    "",
    "레이아웃 인식 가이드:",
    "  - 각 페이지의 상단/하단 영역을 머리글/꼬리글로 구분",
    "  - 표(Table)가 있을 경우 행/열 구조를 유지하여 추출",
    "  - 다단(Multi-column) 레이아웃은 왼쪽→오른쪽, 위→아래 순서로 읽기",
    "  - 도장/서명/워터마크 영역은 별도 표시",
    "  - 글자 크기/굵기 차이로 제목/본문/각주를 구분",
  ];

  if (scannedCount < totalPages) {
    const digitalPages = pageAnalysis.filter((p) => !p.isScanned).map((p) => p.page);
    lines.push(
      "",
      `참고: 페이지 ${digitalPages.join(", ")}은(는) 디지털 텍스트가 포함되어 있어 직접 추출되었습니다.`,
    );
  }

  return lines.join("\n");
}

/**
 * Extract text from a PDF file with automatic scanned PDF detection.
 *
 * For scanned/image PDFs:
 *   - Automatically renders pages as high-resolution images
 *   - Provides layout analysis hints
 *   - Includes OCR guidance for the vision model
 */
export async function renderPdf(
  filePath: string,
  opts?: PdfRenderOptions,
): Promise<PdfRenderResult> {
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  const ocrDpiScale = opts?.ocrDpiScale ?? DEFAULT_OCR_DPI_SCALE;
  const forceScanned = opts?.forceScanned ?? false;

  const buffer = await fs.readFile(filePath);
  const { getDocument } = await loadPdfJs();
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
  }).promise;

  const pagesToProcess = Math.min(pdf.numPages, maxPages);
  const textParts: string[] = [];
  const pageAnalysis: PdfPageTextInfo[] = [];
  const layoutRegions: PdfLayoutRegion[] = [];

  // ── Phase 1: Extract text and analyze each page ──
  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    const pageText = textContent.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .filter(Boolean)
      .join(" ");

    const trimmedText = pageText.trim();
    const isPageScanned = forceScanned || trimmedText.length < MIN_TEXT_PER_PAGE;

    pageAnalysis.push({
      page: pageNum,
      textLength: trimmedText.length,
      isScanned: isPageScanned,
    });

    if (trimmedText) {
      textParts.push(`[Page ${pageNum}]\n${trimmedText}`);
    }

    // Analyze layout for scanned pages
    if (isPageScanned) {
      const regions = await analyzePageLayout(
        page as unknown as {
          getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
        },
        pageNum,
        { width: viewport.width, height: viewport.height },
      );
      layoutRegions.push(...regions);
    }
  }

  const text = textParts.join("\n\n");

  // ── Phase 2: Determine if PDF is scanned ──
  const scannedPageCount = pageAnalysis.filter((p) => p.isScanned).length;
  const isScanned = forceScanned || scannedPageCount > pagesToProcess / 2;

  // ── Phase 3: Render page images ──
  // For scanned PDFs: always render (auto-OCR support)
  // For digital PDFs: only when explicitly requested
  const shouldRenderImages = isScanned || (opts?.renderImages ?? false);
  let pageImages: PdfRenderResult["pageImages"];

  if (shouldRenderImages) {
    const maxPixels = isScanned
      ? SCANNED_MAX_PIXELS // Higher resolution for OCR
      : (opts?.maxPixelsPerPage ?? DEFAULT_MAX_PIXELS);

    try {
      const { createCanvas } = await loadCanvas();
      pageImages = [];

      for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const pagePixels = viewport.width * viewport.height;

        // For scanned PDFs, use higher DPI scale for better OCR
        let scale: number;
        if (isScanned) {
          scale = Math.min(ocrDpiScale, Math.sqrt(maxPixels / pagePixels));
          scale = Math.max(0.5, scale); // Never go below 0.5x for OCR
        } else {
          scale = Math.min(1, Math.sqrt(maxPixels / pagePixels));
          scale = Math.max(0.1, scale);
        }

        const scaled = page.getViewport({ scale });
        const canvasWidth = Math.ceil(scaled.width);
        const canvasHeight = Math.ceil(scaled.height);

        const canvas = createCanvas(canvasWidth, canvasHeight);
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport: scaled,
        }).promise;

        const png = canvas.toBuffer("image/png");
        pageImages.push({
          page: pageNum,
          base64: png.toString("base64"),
          mimeType: "image/png",
          width: canvasWidth,
          height: canvasHeight,
        });
      }
    } catch {
      // Canvas not available — skip image rendering gracefully
      pageImages = undefined;
    }
  }

  // ── Phase 4: Build OCR guidance for scanned PDFs ──
  const ocrGuidance = isScanned ? buildOcrGuidance(pageAnalysis, pdf.numPages) : undefined;

  return {
    text,
    pageCount: pdf.numPages,
    isScanned,
    pageAnalysis,
    layoutRegions: layoutRegions.length > 0 ? layoutRegions : undefined,
    pageImages,
    ocrGuidance,
  };
}
