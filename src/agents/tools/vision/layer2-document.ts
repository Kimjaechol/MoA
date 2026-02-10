/**
 * Layer 2: Document file parser (.docx / .xlsx / .pptx)
 *
 * Uses JSZip to decompress Office Open XML files and extracts text content
 * by parsing the underlying XML.  No heavy external parser is required — we
 * read only the well-known content parts.
 */

import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";
import type { DocumentParseResult } from "./types.js";

/** Detect document type from file extension. */
function detectDocType(filePath: string): "docx" | "xlsx" | "pptx" | "unknown" {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".pptx") return "pptx";
  return "unknown";
}

/** Strip XML tags and decode common XML entities. */
function stripXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract core metadata from docProps/core.xml. */
function extractCoreMetadata(xml: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const tagPatterns: Array<[string, string]> = [
    ["dc:title", "title"],
    ["dc:creator", "author"],
    ["dc:subject", "subject"],
    ["dc:description", "description"],
    ["cp:lastModifiedBy", "lastModifiedBy"],
    ["dcterms:created", "created"],
    ["dcterms:modified", "modified"],
  ];
  for (const [tag, key] of tagPatterns) {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
    if (match?.[1]?.trim()) {
      meta[key] = match[1].trim();
    }
  }
  return meta;
}

/** Count image files inside the zip. */
function countImages(zip: JSZip): number {
  let count = 0;
  zip.forEach((relativePath) => {
    if (/\.(png|jpe?g|gif|bmp|tiff?|emf|wmf)$/i.test(relativePath)) {
      count++;
    }
  });
  return count;
}

// ─── DOCX ──────────────────────────────────────────────

async function parseDocx(zip: JSZip): Promise<{ text: string; pageCount: number }> {
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    return { text: "", pageCount: 0 };
  }
  const xml = await docFile.async("text");

  // Extract paragraph texts (w:t elements hold the text runs)
  const paragraphs: string[] = [];
  const pBlocks = xml.match(/<w:p[\s>][^]*?<\/w:p>/g) ?? [];
  for (const block of pBlocks) {
    const runs = block.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? [];
    const text = runs.map((r) => stripXml(r)).join("");
    if (text.trim()) {
      paragraphs.push(text.trim());
    }
  }

  // Page count: count section breaks + 1 (rough heuristic)
  const sectionBreaks = (xml.match(/<w:sectPr/g) ?? []).length;
  const pageCount = Math.max(1, sectionBreaks);

  return { text: paragraphs.join("\n"), pageCount };
}

// ─── XLSX ──────────────────────────────────────────────

async function parseXlsx(zip: JSZip): Promise<{ text: string; pageCount: number }> {
  // Read shared strings
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings: string[] = [];
  if (sharedStringsFile) {
    const ssXml = await sharedStringsFile.async("text");
    const siBlocks = ssXml.match(/<si>[^]*?<\/si>/g) ?? [];
    for (const block of siBlocks) {
      sharedStrings.push(stripXml(block));
    }
  }

  // Find all sheet files
  const sheetFiles: string[] = [];
  zip.forEach((p) => {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(p)) {
      sheetFiles.push(p);
    }
  });
  sheetFiles.sort();

  const sheets: string[] = [];
  for (const sheetPath of sheetFiles) {
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) continue;
    const xml = await sheetFile.async("text");

    const rows: string[] = [];
    const rowBlocks = xml.match(/<row[\s>][^]*?<\/row>/g) ?? [];
    for (const rowBlock of rowBlocks) {
      const cells = rowBlock.match(/<c[\s>][^]*?<\/c>/g) ?? [];
      const values: string[] = [];
      for (const cell of cells) {
        // t="s" means shared string reference
        const isShared = /\bt="s"/.test(cell);
        const vMatch = cell.match(/<v>([^<]*)<\/v>/);
        if (!vMatch) continue;
        const raw = vMatch[1].trim();
        if (isShared) {
          const idx = parseInt(raw, 10);
          values.push(sharedStrings[idx] ?? raw);
        } else {
          values.push(raw);
        }
      }
      if (values.length > 0) {
        rows.push(values.join("\t"));
      }
    }
    if (rows.length > 0) {
      sheets.push(rows.join("\n"));
    }
  }

  return { text: sheets.join("\n\n---\n\n"), pageCount: sheetFiles.length };
}

// ─── PPTX ──────────────────────────────────────────────

async function parsePptx(zip: JSZip): Promise<{ text: string; pageCount: number }> {
  const slideFiles: string[] = [];
  zip.forEach((p) => {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(p)) {
      slideFiles.push(p);
    }
  });
  slideFiles.sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0", 10);
    const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0", 10);
    return numA - numB;
  });

  const slides: string[] = [];
  for (const slidePath of slideFiles) {
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;
    const xml = await slideFile.async("text");

    // Extract text from a:t elements (text runs in shapes)
    const textRuns = xml.match(/<a:t>[^<]*<\/a:t>/g) ?? [];
    const text = textRuns
      .map((r) => stripXml(r))
      .join(" ")
      .trim();
    if (text) {
      slides.push(text);
    }
  }

  return { text: slides.join("\n\n"), pageCount: slideFiles.length };
}

// ─── Public API ────────────────────────────────────────

export interface DocumentParseOptions {
  /** Maximum text length to return (chars). */
  maxChars?: number;
}

/**
 * Parse an Office Open XML document (.docx/.xlsx/.pptx) and extract
 * text content, metadata, and image counts.
 */
export async function parseDocument(
  filePath: string,
  opts?: DocumentParseOptions,
): Promise<DocumentParseResult> {
  const maxChars = opts?.maxChars ?? 200_000;
  const docType = detectDocType(filePath);

  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);

  // Core metadata
  const coreFile = zip.file("docProps/core.xml");
  const metadata = coreFile ? extractCoreMetadata(await coreFile.async("text")) : {};
  const imageCount = countImages(zip);

  let text: string;
  let pageCount: number;

  switch (docType) {
    case "docx": {
      const result = await parseDocx(zip);
      text = result.text;
      pageCount = result.pageCount;
      break;
    }
    case "xlsx": {
      const result = await parseXlsx(zip);
      text = result.text;
      pageCount = result.pageCount;
      break;
    }
    case "pptx": {
      const result = await parsePptx(zip);
      text = result.text;
      pageCount = result.pageCount;
      break;
    }
    default: {
      // Try all parsers, use whichever yields content
      const docxResult = await parseDocx(zip);
      if (docxResult.text.length > 0) {
        text = docxResult.text;
        pageCount = docxResult.pageCount;
      } else {
        const xlsxResult = await parseXlsx(zip);
        if (xlsxResult.text.length > 0) {
          text = xlsxResult.text;
          pageCount = xlsxResult.pageCount;
        } else {
          const pptxResult = await parsePptx(zip);
          text = pptxResult.text;
          pageCount = pptxResult.pageCount;
        }
      }
      break;
    }
  }

  // Truncate if necessary
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
  }

  return {
    text,
    type: docType,
    pageCount,
    metadata,
    imageCount,
  };
}
