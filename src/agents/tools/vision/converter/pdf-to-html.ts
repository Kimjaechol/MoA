/**
 * PDF → HTML Converter
 *
 * Extracts text with positional information from PDF files and generates
 * styled HTML that preserves the original document layout:
 *   - Text positioning and alignment
 *   - Font names and sizes
 *   - Bold/italic styling
 *   - Table detection and reconstruction
 *   - Line spacing and paragraph structure
 *   - Page breaks
 *
 * For scanned/image PDFs, renders pages as high-res images embedded in HTML.
 */

import fs from "node:fs/promises";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs").catch((err) => {
      pdfJsModulePromise = null;
      throw new Error(`pdfjs-dist required for PDF conversion: ${String(err)}`);
    });
  }
  return pdfJsModulePromise;
}

/** Minimum chars per page to consider it text-based (not scanned). */
const MIN_TEXT_PER_PAGE = 50;

/** A positioned text item extracted from PDF. */
interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  isBold: boolean;
  isItalic: boolean;
}

/** A detected table from grid-aligned text blocks. */
interface DetectedTable {
  rows: string[][];
  startY: number;
  endY: number;
  columnXs: number[];
}

export interface PdfToHtmlOptions {
  /** Maximum pages to convert. Default 20. */
  maxPages?: number;
  /** Include inline CSS for styling. Default true. */
  inlineStyles?: boolean;
  /** Embed scanned page images as base64. Default true. */
  embedImages?: boolean;
  /** Page width in CSS px for layout. Default 794 (A4). */
  pageWidthPx?: number;
}

export interface PdfToHtmlResult {
  html: string;
  pageCount: number;
  isScanned: boolean;
  /** Extracted plain text (fallback). */
  plainText: string;
}

/**
 * Group text items into lines based on Y-coordinate proximity.
 */
function groupIntoLines(items: PdfTextItem[], tolerance: number = 3): PdfTextItem[][] {
  if (items.length === 0) return [];

  // Sort by Y (top to bottom) then X (left to right)
  const sorted = [...items].sort((a, b) => {
    const dy = a.y - b.y;
    if (Math.abs(dy) > tolerance) return dy;
    return a.x - b.x;
  });

  const lines: PdfTextItem[][] = [];
  let currentLine: PdfTextItem[] = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - currentY) <= tolerance) {
      currentLine.push(sorted[i]);
    } else {
      // Sort current line by X
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
      currentLine = [sorted[i]];
      currentY = sorted[i].y;
    }
  }
  if (currentLine.length > 0) {
    currentLine.sort((a, b) => a.x - b.x);
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Detect tables by finding rows/columns with aligned X positions.
 * A table is detected when 3+ consecutive lines share 2+ aligned column starts.
 */
function detectTables(
  lines: PdfTextItem[][],
  pageWidth: number,
  tolerance: number = 8,
): { tables: DetectedTable[]; tableLineIndices: Set<number> } {
  const tables: DetectedTable[] = [];
  const tableLineIndices = new Set<number>();

  // Find column-aligned groups
  const lineColumns: number[][] = lines.map((line) =>
    line.map((item) => Math.round(item.x / tolerance) * tolerance),
  );

  let tableStart = -1;
  let tableColPattern: number[] = [];

  for (let i = 0; i < lineColumns.length; i++) {
    const cols = lineColumns[i];
    if (cols.length < 2) {
      // End current table if any
      if (tableStart >= 0 && i - tableStart >= 3) {
        const tableLines = lines.slice(tableStart, i);
        const rows = tableLines.map((line) => line.map((item) => item.str));
        tables.push({
          rows,
          startY: tableLines[0][0].y,
          endY: tableLines[tableLines.length - 1][0].y,
          columnXs: tableColPattern,
        });
        for (let j = tableStart; j < i; j++) tableLineIndices.add(j);
      }
      tableStart = -1;
      continue;
    }

    if (tableStart < 0) {
      tableStart = i;
      tableColPattern = cols;
    } else {
      // Check alignment with table pattern
      const commonCols = cols.filter((c) =>
        tableColPattern.some((tc) => Math.abs(c - tc) < tolerance),
      );
      if (commonCols.length < 2) {
        // End current table
        if (i - tableStart >= 3) {
          const tableLines = lines.slice(tableStart, i);
          const rows = tableLines.map((line) => line.map((item) => item.str));
          tables.push({
            rows,
            startY: tableLines[0][0].y,
            endY: tableLines[tableLines.length - 1][0].y,
            columnXs: tableColPattern,
          });
          for (let j = tableStart; j < i; j++) tableLineIndices.add(j);
        }
        tableStart = i;
        tableColPattern = cols;
      }
    }
  }

  // Close final table
  if (tableStart >= 0 && lines.length - tableStart >= 3) {
    const tableLines = lines.slice(tableStart, lines.length);
    const rows = tableLines.map((line) => line.map((item) => item.str));
    tables.push({
      rows,
      startY: tableLines[0][0].y,
      endY: tableLines[tableLines.length - 1][0].y,
      columnXs: tableColPattern,
    });
    for (let j = tableStart; j < lines.length; j++) tableLineIndices.add(j);
  }

  return { tables, tableLineIndices };
}

/**
 * Detect text alignment based on X position and page width.
 */
function detectAlignment(line: PdfTextItem[], pageWidth: number): "left" | "center" | "right" {
  if (line.length === 0) return "left";

  const firstX = line[0].x;
  const lastItem = line[line.length - 1];
  const lastEndX = lastItem.x + lastItem.width;
  const leftMargin = firstX;
  const rightMargin = pageWidth - lastEndX;
  const centerDiff = Math.abs(leftMargin - rightMargin);

  // Center-aligned if margins are roughly equal
  if (centerDiff < pageWidth * 0.08 && leftMargin > pageWidth * 0.15) {
    return "center";
  }
  // Right-aligned if right margin is small but left margin is large
  if (rightMargin < pageWidth * 0.1 && leftMargin > pageWidth * 0.3) {
    return "right";
  }
  return "left";
}

/**
 * Convert a single PDF page's text items to HTML.
 */
function pageToHtml(
  items: PdfTextItem[],
  pageWidth: number,
  pageHeight: number,
  pageNum: number,
): string {
  const lines = groupIntoLines(items);
  if (lines.length === 0) return "";

  const { tables, tableLineIndices } = detectTables(lines, pageWidth);
  let tableIndex = 0;
  const parts: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    // Skip lines that are part of a table
    if (tableLineIndices.has(i)) {
      // Emit the table at its first line
      if (i === 0 || !tableLineIndices.has(i - 1)) {
        if (tableIndex < tables.length) {
          const table = tables[tableIndex++];
          parts.push(renderTable(table));
        }
      }
      continue;
    }

    const line = lines[i];
    const alignment = detectAlignment(line, pageWidth);

    // Determine dominant font size
    const avgFontSize = line.reduce((sum, item) => sum + item.fontSize, 0) / line.length;

    // Determine if heading
    const isHeading = avgFontSize > 14;
    const headingTag =
      avgFontSize > 22 ? "h1" : avgFontSize > 18 ? "h2" : avgFontSize > 14 ? "h3" : "p";

    // Build styled text with inline formatting
    const spans = line.map((item) => {
      let text = escapeHtml(item.str);
      if (item.isBold) text = `<strong>${text}</strong>`;
      if (item.isItalic) text = `<em>${text}</em>`;

      // Add font styling if different from page default
      const styles: string[] = [];
      if (item.fontName) {
        const cssFont = mapPdfFont(item.fontName);
        if (cssFont) styles.push(`font-family:${cssFont}`);
      }
      if (item.fontSize && !isHeading) {
        styles.push(`font-size:${item.fontSize}px`);
      }

      if (styles.length > 0) {
        return `<span style="${styles.join(";")}">${text}</span>`;
      }
      return text;
    });

    const lineText = spans.join(" ");
    const alignStyle = alignment !== "left" ? ` style="text-align:${alignment}"` : "";

    // Calculate line spacing from previous line
    let marginTop = "";
    if (i > 0 && !tableLineIndices.has(i - 1)) {
      const prevLine = lines[i - 1];
      const gap = line[0].y - prevLine[0].y;
      const expectedGap = avgFontSize * 1.5;
      if (gap > expectedGap * 1.8) {
        marginTop = ` style="margin-top:${Math.round(gap - expectedGap)}px${alignment !== "left" ? `;text-align:${alignment}` : ""}"`;
        if (marginTop) {
          parts.push(`<${headingTag}${marginTop}>${lineText}</${headingTag}>`);
          continue;
        }
      }
    }

    parts.push(`<${headingTag}${alignStyle}>${lineText}</${headingTag}>`);
  }

  return parts.join("\n");
}

/**
 * Render a detected table as HTML.
 */
function renderTable(table: DetectedTable): string {
  const maxCols = Math.max(...table.rows.map((r) => r.length));
  const lines: string[] = ['<table style="width:100%;border-collapse:collapse;margin:12px 0">'];

  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    const tag = i === 0 ? "th" : "td";
    lines.push("  <tr>");
    for (let j = 0; j < maxCols; j++) {
      const cellText = escapeHtml(row[j] ?? "");
      lines.push(
        `    <${tag} style="border:1px solid #ddd;padding:6px 10px;text-align:left">${cellText}</${tag}>`,
      );
    }
    lines.push("  </tr>");
  }

  lines.push("</table>");
  return lines.join("\n");
}

/**
 * Map PDF font name to CSS font-family.
 */
function mapPdfFont(pdfFontName: string): string {
  const lower = pdfFontName.toLowerCase();

  if (lower.includes("batang") || lower.includes("바탕")) {
    return '"Batang", "바탕", serif';
  }
  if (lower.includes("gulim") || lower.includes("굴림")) {
    return '"Gulim", "굴림", sans-serif';
  }
  if (lower.includes("dotum") || lower.includes("돋움")) {
    return '"Dotum", "돋움", sans-serif';
  }
  if (lower.includes("malgun") || lower.includes("맑은")) {
    return '"Malgun Gothic", "맑은 고딕", sans-serif';
  }
  if (lower.includes("nanum") || lower.includes("나눔")) {
    if (lower.includes("myeongjo") || lower.includes("명조")) {
      return '"Nanum Myeongjo", "나눔명조", serif';
    }
    return '"Nanum Gothic", "나눔고딕", sans-serif';
  }
  if (lower.includes("arial")) {
    return "Arial, sans-serif";
  }
  if (lower.includes("times")) {
    return '"Times New Roman", Times, serif';
  }
  if (lower.includes("courier")) {
    return '"Courier New", Courier, monospace';
  }
  if (lower.includes("helvetica")) {
    return "Helvetica, Arial, sans-serif";
  }

  return "";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the full HTML document wrapping page contents.
 */
function buildHtmlDocument(pageHtmls: string[], pageWidthPx: number, title: string): string {
  const pages = pageHtmls
    .map(
      (html, i) =>
        `<div class="pdf-page" id="page-${i + 1}">
  <div class="page-number">Page ${i + 1}</div>
${html}
</div>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Malgun Gothic", "맑은 고딕", -apple-system, sans-serif;
    background: #f5f5f5;
    color: #222;
    line-height: 1.6;
    padding: 20px;
  }
  .pdf-page {
    max-width: ${pageWidthPx}px;
    margin: 0 auto 24px auto;
    background: white;
    padding: 48px 56px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    border-radius: 4px;
    position: relative;
    page-break-after: always;
  }
  .page-number {
    position: absolute;
    top: 12px;
    right: 16px;
    font-size: 11px;
    color: #999;
  }
  h1 { font-size: 24px; font-weight: 700; margin: 16px 0 8px 0; }
  h2 { font-size: 20px; font-weight: 700; margin: 14px 0 6px 0; }
  h3 { font-size: 16px; font-weight: 600; margin: 10px 0 4px 0; }
  p { margin: 4px 0; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 12px; }
  th { background: #f8f8f8; font-weight: 600; }
  .scanned-page img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  .scanned-notice {
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 4px;
    padding: 12px 16px;
    margin-bottom: 16px;
    font-size: 13px;
    color: #856404;
  }
  @media print {
    body { background: white; padding: 0; }
    .pdf-page { box-shadow: none; margin: 0; padding: 24px; }
    .page-number { display: none; }
  }
</style>
</head>
<body>
${pages}
</body>
</html>`;
}

/**
 * Convert a PDF file to styled HTML preserving layout and formatting.
 */
export async function convertPdfToHtml(
  filePath: string,
  opts?: PdfToHtmlOptions,
): Promise<PdfToHtmlResult> {
  const maxPages = opts?.maxPages ?? 20;
  const pageWidthPx = opts?.pageWidthPx ?? 794;
  const embedImages = opts?.embedImages ?? true;

  const buffer = await fs.readFile(filePath);
  const { getDocument } = await loadPdfJs();
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
  }).promise;

  const pagesToProcess = Math.min(pdf.numPages, maxPages);
  const pageHtmls: string[] = [];
  const plainTextParts: string[] = [];
  let scannedPageCount = 0;

  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    // Extract positioned text items
    const items: PdfTextItem[] = [];
    let pageText = "";

    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;

      const str = String(item.str);
      pageText += str + " ";

      // Extract position from transform matrix [scaleX, skewY, skewX, scaleY, translateX, translateY]
      const tx = (item as { transform?: number[] }).transform;
      if (!tx || tx.length < 6) continue;

      const fontSize = Math.abs(tx[3]) || Math.abs(tx[0]) || 12;
      const x = tx[4];
      // PDF Y is from bottom, convert to top-down
      const y = viewport.height - tx[5];

      const fontName = (item as { fontName?: string }).fontName ?? "";
      const isBold = /bold/i.test(fontName) || /\-B[,\s]|BD|Black/i.test(fontName);
      const isItalic = /italic|oblique/i.test(fontName) || /\-I[,\s]|It\b/i.test(fontName);

      items.push({
        str,
        x,
        y,
        width: (item as { width?: number }).width ?? str.length * fontSize * 0.6,
        height: fontSize,
        fontSize,
        fontName,
        isBold,
        isItalic,
      });
    }

    const trimmedText = pageText.trim();
    plainTextParts.push(trimmedText);

    if (trimmedText.length < MIN_TEXT_PER_PAGE) {
      scannedPageCount++;

      // For scanned pages, try to embed page image
      if (embedImages) {
        try {
          const canvasModule = await import("@napi-rs/canvas");
          const scale = Math.min(2.0, Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
          const scaled = page.getViewport({ scale });
          const canvas = canvasModule.createCanvas(
            Math.ceil(scaled.width),
            Math.ceil(scaled.height),
          );
          await page.render({
            canvas: canvas as unknown as HTMLCanvasElement,
            viewport: scaled,
          }).promise;
          const png = canvas.toBuffer("image/png");
          const b64 = png.toString("base64");

          pageHtmls.push(
            `<div class="scanned-page">\n` +
              `  <div class="scanned-notice">이 페이지는 스캔/이미지 기반입니다. OCR 변환된 이미지입니다.</div>\n` +
              `  <img src="data:image/png;base64,${b64}" alt="Page ${pageNum}" width="${Math.ceil(scaled.width)}" height="${Math.ceil(scaled.height)}">\n` +
              (trimmedText
                ? `  <div style="margin-top:12px;color:#666;font-size:11px"><em>감지된 텍스트: ${escapeHtml(trimmedText)}</em></div>\n`
                : "") +
              `</div>`,
          );
        } catch {
          // Canvas not available — text-only fallback
          pageHtmls.push(
            `<div class="scanned-page">\n` +
              `  <div class="scanned-notice">이 페이지는 스캔/이미지 기반입니다. 이미지 렌더링 불가.</div>\n` +
              (trimmedText ? `  <p>${escapeHtml(trimmedText)}</p>\n` : "") +
              `</div>`,
          );
        }
      } else {
        pageHtmls.push(
          `<div class="scanned-page">\n` +
            `  <p style="color:#999;font-style:italic">[스캔 페이지 — 이미지 임베딩 비활성화]</p>\n` +
            `</div>`,
        );
      }
    } else {
      // Digital page — convert to styled HTML
      const html = pageToHtml(items, viewport.width, viewport.height, pageNum);
      pageHtmls.push(html || `<p style="color:#999">[빈 페이지]</p>`);
    }
  }

  const isScanned = scannedPageCount > pagesToProcess / 2;
  const title = filePath.split("/").pop() ?? "document";

  return {
    html: buildHtmlDocument(pageHtmls, pageWidthPx, title),
    pageCount: pdf.numPages,
    isScanned,
    plainText: plainTextParts.join("\n\n"),
  };
}
