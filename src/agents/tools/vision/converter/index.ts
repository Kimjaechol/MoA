/**
 * Document Converter — unified public API
 *
 * Provides conversion between PDF/Office documents and HTML/Markdown formats,
 * plus a self-contained HTML editor for viewing and editing converted documents.
 */

export { convertPdfToHtml, type PdfToHtmlOptions, type PdfToHtmlResult } from "./pdf-to-html.js";
export { convertDocToHtml, type DocToHtmlOptions, type DocToHtmlResult } from "./doc-to-html.js";
export { convertHtmlToMarkdown, type HtmlToMarkdownOptions } from "./html-to-markdown.js";
export { generateEditorHtml, type EditorTemplateOptions } from "./editor-template.js";

import fs from "node:fs/promises";
import path from "node:path";
import { convertDocToHtml, type DocToHtmlOptions } from "./doc-to-html.js";
import { generateEditorHtml } from "./editor-template.js";
import { convertHtmlToMarkdown } from "./html-to-markdown.js";
import { convertPdfToHtml, type PdfToHtmlOptions } from "./pdf-to-html.js";

export type ConvertOutputFormat = "html" | "markdown" | "editor";

export interface ConvertOptions {
  /** Output format. Default "html". */
  format?: ConvertOutputFormat;
  /** Maximum pages for PDF. */
  maxPages?: number;
  /** Save output to this file path. */
  outputPath?: string;
  /** Editor theme. */
  editorTheme?: "light" | "dark";
}

export interface ConvertResult {
  /** Converted content (HTML or Markdown string). */
  content: string;
  /** Output format used. */
  format: ConvertOutputFormat;
  /** Source document type. */
  sourceType: "pdf" | "docx" | "xlsx" | "pptx" | "hwpx" | "unknown";
  /** Number of pages/sheets/slides. */
  pageCount: number;
  /** Whether the PDF was scanned/image-based. */
  isScanned?: boolean;
  /** Plain text extraction (always available). */
  plainText: string;
  /** Path where output was saved (if outputPath was given). */
  savedTo?: string;
}

/**
 * Convert any supported document to the requested format.
 *
 * Supports: .pdf, .docx, .xlsx, .pptx, .hwpx
 * Output: html, markdown, or editor (self-contained HTML editor)
 */
export async function convertDocument(
  filePath: string,
  opts?: ConvertOptions,
): Promise<ConvertResult> {
  const format = opts?.format ?? "html";
  const ext = path.extname(filePath).toLowerCase();

  let html: string;
  let plainText: string;
  let pageCount: number;
  let sourceType: ConvertResult["sourceType"];
  let isScanned: boolean | undefined;

  // Step 1: Convert source to HTML
  if (ext === ".pdf") {
    const pdfOpts: PdfToHtmlOptions = { maxPages: opts?.maxPages };
    const result = await convertPdfToHtml(filePath, pdfOpts);
    html = result.html;
    plainText = result.plainText;
    pageCount = result.pageCount;
    sourceType = "pdf";
    isScanned = result.isScanned;
  } else if ([".docx", ".xlsx", ".pptx", ".hwpx"].includes(ext)) {
    const docOpts: DocToHtmlOptions = {};
    const result = await convertDocToHtml(filePath, docOpts);
    html = result.html;
    plainText = result.plainText;
    pageCount = result.pageCount;
    sourceType = result.type;
  } else {
    throw new Error(
      `지원하지 않는 파일 형식입니다: ${ext}\n` + "지원 형식: .pdf, .docx, .xlsx, .pptx, .hwpx",
    );
  }

  // Step 2: Convert to requested output format
  let content: string;

  switch (format) {
    case "html":
      content = html;
      break;

    case "markdown":
      content = convertHtmlToMarkdown(html);
      break;

    case "editor":
      content = generateEditorHtml({
        title: path.basename(filePath, ext),
        content: html,
        theme: opts?.editorTheme ?? "light",
        lang: "ko",
      });
      break;

    default:
      throw new Error(`지원하지 않는 출력 형식: ${format}`);
  }

  // Step 3: Save to file if requested
  let savedTo: string | undefined;
  if (opts?.outputPath) {
    await fs.writeFile(opts.outputPath, content, "utf-8");
    savedTo = opts.outputPath;
  }

  return {
    content,
    format,
    sourceType,
    pageCount,
    isScanned,
    plainText,
    savedTo,
  };
}
