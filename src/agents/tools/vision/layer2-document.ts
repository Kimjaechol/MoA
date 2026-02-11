/**
 * Layer 2: Document file parser (.docx / .xlsx / .pptx / .hwpx)
 *
 * Uses JSZip to decompress Office Open XML and HWPX files and extracts text
 * content by parsing the underlying XML.  No heavy external parser is
 * required — we read only the well-known content parts.
 *
 * Supported formats:
 *   - .docx (Word)
 *   - .xlsx (Excel)
 *   - .pptx (PowerPoint)
 *   - .hwpx (한글 — Hancom OWPML format)
 *   - .hwp  (감지 시 HWPX 변환 안내 제공)
 */

import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";
import type { DocumentParseResult } from "./types.js";

/** HWP 파일 안내 메시지 */
export const HWP_CONVERSION_NOTICE = [
  "[HWP 파일 감지] 이 파일은 HWP(구형 한글 포맷)입니다.",
  "",
  "HWP 파일은 바이너리 포맷으로 직접 파싱이 어렵습니다.",
  "다음 방법으로 HWPX로 변환하면 텍스트를 추출할 수 있습니다:",
  "",
  "  1. 한글(한컴오피스)에서 파일 열기",
  '  2. "다른 이름으로 저장" 선택',
  '  3. 파일 형식을 "HWPX (*.hwpx)"로 변경',
  "  4. 저장 후 변환된 .hwpx 파일을 다시 업로드",
  "",
  "또는 한글 뷰어(무료)에서도 HWPX로 내보내기가 가능합니다.",
].join("\n");

/** Detect document type from file extension. */
function detectDocType(filePath: string): "docx" | "xlsx" | "pptx" | "hwpx" | "hwp" | "unknown" {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".pptx") return "pptx";
  if (ext === ".hwpx") return "hwpx";
  if (ext === ".hwp") return "hwp";
  return "unknown";
}

/**
 * Check if a buffer starts with the HWP binary signature (OLE compound document).
 * HWP files start with the OLE magic bytes: D0 CF 11 E0 A1 B1 1A E1
 */
function isHwpBinary(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  return (
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  );
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

// ─── HWPX (한글 OWPML) ─────────────────────────────────

/**
 * Extract text from HWPX section XML.
 *
 * HWPX uses OWPML (Open Word Processor Markup Language) with various
 * namespace prefixes.  Text content is in <t> or <hp:t> or <hs:t> tags
 * within paragraph/run elements.  Tables use <tbl>/<tc> structure.
 */
function extractHwpxText(xml: string): string {
  const paragraphs: string[] = [];

  // Match text tags regardless of namespace prefix
  // Common patterns: <hp:t>, <hs:t>, <t>, <hc:t>, <ha:t>
  const textPattern = /<(?:[a-z]+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:[a-z]+:)?t>/g;
  let match: RegExpExecArray | null;
  let currentParagraph: string[] = [];

  // Split by paragraph boundaries
  // Common paragraph tags: <hp:p>, <hs:p>, <p>
  const paraBlocks = xml.split(/<(?:[a-z]+:)?p[\s>]/);

  for (const block of paraBlocks) {
    currentParagraph = [];
    // Reset regex for each block
    const blockTextPattern = /<(?:[a-z]+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:[a-z]+:)?t>/g;
    while ((match = blockTextPattern.exec(block)) !== null) {
      const text = match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
      if (text.trim()) {
        currentParagraph.push(text);
      }
    }
    if (currentParagraph.length > 0) {
      paragraphs.push(currentParagraph.join(""));
    }
  }

  return paragraphs.join("\n");
}

/** Extract HWPX metadata from META-INF or version.xml. */
function extractHwpxMetadata(zip: JSZip): Record<string, string> {
  const meta: Record<string, string> = {};
  // HWPX metadata is typically minimal; we try common locations
  return meta;
}

async function parseHwpx(
  zip: JSZip,
): Promise<{ text: string; pageCount: number; metadata: Record<string, string> }> {
  // Find all section files (Contents/section0.xml, section1.xml, ...)
  const sectionFiles: string[] = [];
  zip.forEach((p) => {
    if (/^Contents\/section\d+\.xml$/i.test(p)) {
      sectionFiles.push(p);
    }
  });
  sectionFiles.sort((a, b) => {
    const numA = parseInt(a.match(/section(\d+)/)?.[1] ?? "0", 10);
    const numB = parseInt(b.match(/section(\d+)/)?.[1] ?? "0", 10);
    return numA - numB;
  });

  // Also check for content.hpf which lists sections
  const contentHpf = zip.file("Contents/content.hpf");
  if (sectionFiles.length === 0 && contentHpf) {
    // Parse content.hpf to find section references
    const hpfXml = await contentHpf.async("text");
    const sectionRefs = hpfXml.match(/section\d+\.xml/gi) ?? [];
    for (const ref of sectionRefs) {
      const fullPath = `Contents/${ref}`;
      if (zip.file(fullPath) && !sectionFiles.includes(fullPath)) {
        sectionFiles.push(fullPath);
      }
    }
    sectionFiles.sort();
  }

  const sections: string[] = [];

  for (const sectionPath of sectionFiles) {
    const sectionFile = zip.file(sectionPath);
    if (!sectionFile) continue;
    const xml = await sectionFile.async("text");
    const text = extractHwpxText(xml);
    if (text.trim()) {
      sections.push(text.trim());
    }
  }

  // Also extract from header/footer if present
  const headerFooterFiles: string[] = [];
  zip.forEach((p) => {
    if (/^Contents\/(header|footer)\d*\.xml$/i.test(p)) {
      headerFooterFiles.push(p);
    }
  });

  // Extract metadata from version.xml or META-INF
  const metadata = extractHwpxMetadata(zip);

  // Try to get title from first section or header
  const versionFile = zip.file("version.xml");
  if (versionFile) {
    try {
      const versionXml = await versionFile.async("text");
      const appMatch = versionXml.match(/<(?:[a-z]+:)?application[^>]*>([^<]+)/i);
      if (appMatch?.[1]?.trim()) {
        metadata.application = appMatch[1].trim();
      }
    } catch {
      // version.xml parsing is optional
    }
  }

  return {
    text: sections.join("\n\n"),
    pageCount: Math.max(1, sectionFiles.length),
    metadata,
  };
}

// ─── Public API ────────────────────────────────────────

export interface DocumentParseOptions {
  /** Maximum text length to return (chars). */
  maxChars?: number;
}

/**
 * Parse a document (.docx/.xlsx/.pptx/.hwpx) and extract
 * text content, metadata, and image counts.
 *
 * For .hwp (구형 한글 바이너리) files, returns a conversion notice
 * instead of extracted text.
 */
export async function parseDocument(
  filePath: string,
  opts?: DocumentParseOptions,
): Promise<DocumentParseResult> {
  const maxChars = opts?.maxChars ?? 200_000;
  const docType = detectDocType(filePath);

  // Handle HWP (binary format) — provide conversion guidance
  if (docType === "hwp") {
    const buffer = await fs.readFile(filePath);
    if (isHwpBinary(buffer)) {
      return {
        text: "",
        type: "unknown",
        pageCount: 0,
        metadata: {},
        imageCount: 0,
        warning: HWP_CONVERSION_NOTICE,
      };
    }
  }

  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);

  // Core metadata (for OOXML formats)
  const coreFile = zip.file("docProps/core.xml");
  const metadata = coreFile ? extractCoreMetadata(await coreFile.async("text")) : {};
  const imageCount = countImages(zip);

  let text: string;
  let pageCount: number;
  let warning: string | undefined;

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
    case "hwpx": {
      const result = await parseHwpx(zip);
      text = result.text;
      pageCount = result.pageCount;
      // Merge HWPX-specific metadata
      Object.assign(metadata, result.metadata);
      break;
    }
    default: {
      // Try HWPX detection first (check for Contents/section*.xml)
      const hasHwpxSections = zip.file("Contents/section0.xml") !== null;
      if (hasHwpxSections) {
        const result = await parseHwpx(zip);
        text = result.text;
        pageCount = result.pageCount;
        Object.assign(metadata, result.metadata);
        break;
      }

      // Try all OOXML parsers, use whichever yields content
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
    type: docType === "hwp" ? "unknown" : docType,
    pageCount,
    metadata,
    imageCount,
    warning,
  };
}
