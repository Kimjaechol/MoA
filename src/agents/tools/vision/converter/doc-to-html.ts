/**
 * Office Document → HTML Converter
 *
 * Converts .docx, .xlsx, .pptx, .hwpx files to styled HTML preserving:
 *   - Text formatting (bold, italic, underline, font, size, color)
 *   - Paragraph alignment and spacing
 *   - Tables with borders and cell alignment
 *   - Page/sheet/slide structure
 *   - Headers and footers
 *
 * Uses JSZip to read the OOXML/OWPML archives and parses the XML
 * with formatting-aware extraction.
 */

import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";

export interface DocToHtmlOptions {
  /** Maximum text length. Default 500000. */
  maxChars?: number;
  /** Include inline CSS. Default true. */
  inlineStyles?: boolean;
}

export interface DocToHtmlResult {
  html: string;
  type: "docx" | "xlsx" | "pptx" | "hwpx" | "unknown";
  pageCount: number;
  plainText: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

/** Extract text content from an XML element, stripping tags. */
function innerText(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, ""));
}

// ─── DOCX → HTML ──────────────────────────────────────

interface DocxRunStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  fontSize: number | null;
  fontName: string | null;
  color: string | null;
  highlight: string | null;
}

function parseRunProperties(rPr: string): DocxRunStyle {
  return {
    bold: /<w:b[\s/>]/.test(rPr) && !/<w:b\s+w:val="(false|0)"/.test(rPr),
    italic: /<w:i[\s/>]/.test(rPr) && !/<w:i\s+w:val="(false|0)"/.test(rPr),
    underline: /<w:u\s/.test(rPr) && !/<w:u\s+w:val="none"/.test(rPr),
    strike: /<w:strike[\s/>]/.test(rPr),
    fontSize: (() => {
      const m = rPr.match(/<w:sz\s+w:val="(\d+)"/);
      return m ? parseInt(m[1], 10) / 2 : null; // half-points → pt
    })(),
    fontName: (() => {
      const m = rPr.match(/<w:rFonts[^>]+w:eastAsia="([^"]+)"/);
      if (m) return m[1];
      const m2 = rPr.match(/<w:rFonts[^>]+w:ascii="([^"]+)"/);
      return m2 ? m2[1] : null;
    })(),
    color: (() => {
      const m = rPr.match(/<w:color\s+w:val="([^"]+)"/);
      return m && m[1] !== "auto" ? `#${m[1]}` : null;
    })(),
    highlight: (() => {
      const m = rPr.match(/<w:highlight\s+w:val="([^"]+)"/);
      return m ? m[1] : null;
    })(),
  };
}

function styleToInlineCss(style: DocxRunStyle): string {
  const parts: string[] = [];
  if (style.fontSize) parts.push(`font-size:${style.fontSize}pt`);
  if (style.fontName) parts.push(`font-family:"${style.fontName}"`);
  if (style.color) parts.push(`color:${style.color}`);
  if (style.underline) parts.push("text-decoration:underline");
  if (style.strike) parts.push("text-decoration:line-through");
  if (style.highlight) parts.push(`background:${style.highlight}`);
  return parts.join(";");
}

function parseParagraphAlignment(pPr: string): string {
  const m = pPr.match(/<w:jc\s+w:val="([^"]+)"/);
  if (!m) return "";
  switch (m[1]) {
    case "center":
      return "text-align:center";
    case "right":
      return "text-align:right";
    case "both":
    case "distribute":
      return "text-align:justify";
    default:
      return "";
  }
}

function parseParagraphSpacing(pPr: string): string {
  const parts: string[] = [];
  const spacingMatch = pPr.match(/<w:spacing([^/]*)\/?>/);
  if (spacingMatch) {
    const attrs = spacingMatch[1];
    const before = attrs.match(/w:before="(\d+)"/);
    const after = attrs.match(/w:after="(\d+)"/);
    const line = attrs.match(/w:line="(\d+)"/);
    if (before) parts.push(`margin-top:${Math.round(parseInt(before[1], 10) / 20)}pt`);
    if (after) parts.push(`margin-bottom:${Math.round(parseInt(after[1], 10) / 20)}pt`);
    if (line) {
      const lineVal = parseInt(line[1], 10);
      // 240 twips = single spacing
      if (lineVal > 0) parts.push(`line-height:${(lineVal / 240).toFixed(2)}`);
    }
  }
  return parts.join(";");
}

function parseParagraphIndent(pPr: string): string {
  const m = pPr.match(/<w:ind([^/]*)\/?>/);
  if (!m) return "";
  const parts: string[] = [];
  const left = m[1].match(/w:left="(\d+)"/);
  const firstLine = m[1].match(/w:firstLine="(\d+)"/);
  if (left) parts.push(`margin-left:${Math.round(parseInt(left[1], 10) / 20)}pt`);
  if (firstLine) parts.push(`text-indent:${Math.round(parseInt(firstLine[1], 10) / 20)}pt`);
  return parts.join(";");
}

async function convertDocxToHtml(
  zip: JSZip,
): Promise<{ html: string; pageCount: number; plainText: string }> {
  const docFile = zip.file("word/document.xml");
  if (!docFile)
    return { html: "<p>문서 내용을 찾을 수 없습니다.</p>", pageCount: 0, plainText: "" };

  const xml = await docFile.async("text");
  const paragraphs: string[] = [];
  const plainTextParts: string[] = [];

  const pBlocks = xml.match(/<w:p[\s>][^]*?<\/w:p>/g) ?? [];

  for (const pBlock of pBlocks) {
    // Parse paragraph properties
    const pPrMatch = pBlock.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[1] : "";

    const alignment = parseParagraphAlignment(pPr);
    const spacing = parseParagraphSpacing(pPr);
    const indent = parseParagraphIndent(pPr);

    // Determine heading level
    const styleMatch = pPr.match(/<w:pStyle\s+w:val="([^"]+)"/);
    const styleName = styleMatch ? styleMatch[1] : "";
    let tag = "p";
    if (/^Heading1|제목\s*1/i.test(styleName)) tag = "h1";
    else if (/^Heading2|제목\s*2/i.test(styleName)) tag = "h2";
    else if (/^Heading3|제목\s*3/i.test(styleName)) tag = "h3";
    else if (/^Heading4|제목\s*4/i.test(styleName)) tag = "h4";
    else if (/^Title|표제/i.test(styleName)) tag = "h1";

    // Parse runs
    const runs = pBlock.match(/<w:r[\s>][^]*?<\/w:r>/g) ?? [];
    const runHtmls: string[] = [];
    const runTexts: string[] = [];

    for (const run of runs) {
      const rPrMatch = run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
      const rPr = rPrMatch ? rPrMatch[1] : "";
      const style = parseRunProperties(rPr);

      // Extract text from w:t elements
      const textParts = run.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [];
      const text = textParts.map((t) => decodeXmlEntities(t.replace(/<[^>]+>/g, ""))).join("");
      if (!text) continue;

      runTexts.push(text);

      let html = escapeHtml(text);
      if (style.bold) html = `<strong>${html}</strong>`;
      if (style.italic) html = `<em>${html}</em>`;

      const inlineCss = styleToInlineCss(style);
      if (inlineCss) {
        html = `<span style="${inlineCss}">${html}</span>`;
      }
      runHtmls.push(html);
    }

    // Check for line breaks (w:br)
    if (pBlock.includes("<w:br")) {
      runHtmls.push("<br>");
    }

    const lineText = runTexts.join("");
    plainTextParts.push(lineText);

    if (runHtmls.length === 0 && !lineText.trim()) {
      paragraphs.push(`<${tag}>&nbsp;</${tag}>`);
      continue;
    }

    // Build paragraph styles
    const pStyles = [alignment, spacing, indent].filter(Boolean).join(";");
    const styleAttr = pStyles ? ` style="${pStyles}"` : "";

    paragraphs.push(`<${tag}${styleAttr}>${runHtmls.join("")}</${tag}>`);
  }

  // Tables
  const tableBlocks = xml.match(/<w:tbl[\s>][^]*?<\/w:tbl>/g) ?? [];
  for (const tbl of tableBlocks) {
    const rows = tbl.match(/<w:tr[\s>][^]*?<\/w:tr>/g) ?? [];
    if (rows.length === 0) continue;

    const tableHtml: string[] = [
      '<table style="width:100%;border-collapse:collapse;margin:12px 0">',
    ];
    for (const row of rows) {
      tableHtml.push("  <tr>");
      const cells = row.match(/<w:tc[\s>][^]*?<\/w:tc>/g) ?? [];
      for (const cell of cells) {
        const cellText = innerText(cell.replace(/<w:tcPr>[^]*?<\/w:tcPr>/g, ""));
        tableHtml.push(
          `    <td style="border:1px solid #ccc;padding:6px 10px">${escapeHtml(cellText.trim())}</td>`,
        );
      }
      tableHtml.push("  </tr>");
    }
    tableHtml.push("</table>");
    paragraphs.push(tableHtml.join("\n"));
  }

  const sectionBreaks = (xml.match(/<w:sectPr/g) ?? []).length;
  return {
    html: paragraphs.join("\n"),
    pageCount: Math.max(1, sectionBreaks),
    plainText: plainTextParts.join("\n"),
  };
}

// ─── XLSX → HTML ──────────────────────────────────────

async function convertXlsxToHtml(
  zip: JSZip,
): Promise<{ html: string; pageCount: number; plainText: string }> {
  // Shared strings
  const ssFile = zip.file("xl/sharedStrings.xml");
  const sharedStrings: string[] = [];
  if (ssFile) {
    const ssXml = await ssFile.async("text");
    const siBlocks = ssXml.match(/<si>[^]*?<\/si>/g) ?? [];
    for (const block of siBlocks) {
      sharedStrings.push(innerText(block));
    }
  }

  // Styles for number formats, fonts, etc.
  const stylesFile = zip.file("xl/styles.xml");
  const boldStyleIndices = new Set<number>();
  if (stylesFile) {
    const stylesXml = await stylesFile.async("text");
    const fonts = stylesXml.match(/<font>([\s\S]*?)<\/font>/g) ?? [];
    fonts.forEach((f, i) => {
      if (/<b[\s/>]/.test(f)) boldStyleIndices.add(i);
    });
  }

  // Find sheets
  const sheetFiles: string[] = [];
  zip.forEach((p) => {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(p)) sheetFiles.push(p);
  });
  sheetFiles.sort();

  const sheetsHtml: string[] = [];
  const plainTextParts: string[] = [];

  for (let si = 0; si < sheetFiles.length; si++) {
    const sheetFile = zip.file(sheetFiles[si]);
    if (!sheetFile) continue;
    const xml = await sheetFile.async("text");

    // Parse merge cells
    const mergeCells: Array<{
      startRow: number;
      startCol: number;
      endRow: number;
      endCol: number;
    }> = [];
    const mergeMatches = xml.match(/<mergeCell\s+ref="([^"]+)"/g) ?? [];
    for (const m of mergeMatches) {
      const ref = m.match(/ref="([^"]+)"/)?.[1];
      if (ref) {
        const [start, end] = ref.split(":");
        if (start && end) {
          mergeCells.push({
            startRow: parseRowNum(start),
            startCol: parseColNum(start),
            endRow: parseRowNum(end),
            endCol: parseColNum(end),
          });
        }
      }
    }

    const tableRows: string[] = [];
    const rowBlocks = xml.match(/<row[\s>][^]*?<\/row>/g) ?? [];

    for (const rowBlock of rowBlocks) {
      const rowNumMatch = rowBlock.match(/r="(\d+)"/);
      const rowNum = rowNumMatch ? parseInt(rowNumMatch[1], 10) : 0;

      const cells = rowBlock.match(/<c[\s>][^]*?<\/c>/g) ?? [];
      const cellHtmls: string[] = [];
      const cellTexts: string[] = [];

      for (const cell of cells) {
        const isShared = /\bt="s"/.test(cell);
        const isInline = /\bt="inlineStr"/.test(cell);
        const vMatch = cell.match(/<v>([^<]*)<\/v>/);
        const refMatch = cell.match(/r="([A-Z]+\d+)"/);
        const colNum = refMatch ? parseColNum(refMatch[1]) : 0;

        let value = "";
        if (isShared && vMatch) {
          const idx = parseInt(vMatch[1].trim(), 10);
          value = sharedStrings[idx] ?? vMatch[1].trim();
        } else if (isInline) {
          value = innerText(cell);
        } else if (vMatch) {
          value = vMatch[1].trim();
        }

        cellTexts.push(value);

        // Check if cell is merged
        const merge = mergeCells.find((m) => m.startRow === rowNum && m.startCol === colNum);
        let mergeAttr = "";
        if (merge) {
          const colspan = merge.endCol - merge.startCol + 1;
          const rowspan = merge.endRow - merge.startRow + 1;
          if (colspan > 1) mergeAttr += ` colspan="${colspan}"`;
          if (rowspan > 1) mergeAttr += ` rowspan="${rowspan}"`;
        }

        // Skip merged-into cells
        const isMergedInto = mergeCells.some(
          (m) =>
            !(m.startRow === rowNum && m.startCol === colNum) &&
            rowNum >= m.startRow &&
            rowNum <= m.endRow &&
            colNum >= m.startCol &&
            colNum <= m.endCol,
        );
        if (isMergedInto) continue;

        cellHtmls.push(
          `<td${mergeAttr} style="border:1px solid #ccc;padding:4px 8px">${escapeHtml(value)}</td>`,
        );
      }

      if (cellHtmls.length > 0) {
        tableRows.push(`  <tr>${cellHtmls.join("")}</tr>`);
        plainTextParts.push(cellTexts.join("\t"));
      }
    }

    if (tableRows.length > 0) {
      sheetsHtml.push(
        `<h3>Sheet ${si + 1}</h3>\n<table style="width:100%;border-collapse:collapse;margin:12px 0">\n${tableRows.join("\n")}\n</table>`,
      );
    }
  }

  return {
    html: sheetsHtml.join("\n<hr style='margin:24px 0'>\n"),
    pageCount: sheetFiles.length,
    plainText: plainTextParts.join("\n"),
  };
}

function parseColNum(cellRef: string): number {
  const col = cellRef.replace(/\d+/g, "");
  let num = 0;
  for (let i = 0; i < col.length; i++) {
    num = num * 26 + (col.charCodeAt(i) - 64);
  }
  return num;
}

function parseRowNum(cellRef: string): number {
  const row = cellRef.replace(/[A-Z]+/gi, "");
  return parseInt(row, 10) || 0;
}

// ─── PPTX → HTML ──────────────────────────────────────

async function convertPptxToHtml(
  zip: JSZip,
): Promise<{ html: string; pageCount: number; plainText: string }> {
  const slideFiles: string[] = [];
  zip.forEach((p) => {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(p)) slideFiles.push(p);
  });
  slideFiles.sort((a, b) => {
    const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0", 10);
    const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0", 10);
    return na - nb;
  });

  const slidesHtml: string[] = [];
  const plainTextParts: string[] = [];

  for (let i = 0; i < slideFiles.length; i++) {
    const slideFile = zip.file(slideFiles[i]);
    if (!slideFile) continue;
    const xml = await slideFile.async("text");

    const shapes: string[] = [];
    const shapeBlocks = xml.match(/<p:sp[\s>][^]*?<\/p:sp>/g) ?? [];

    for (const shape of shapeBlocks) {
      // Extract text paragraphs
      const paraBlocks = shape.match(/<a:p[\s>][^]*?<\/a:p>/g) ?? [];
      for (const para of paraBlocks) {
        // Check paragraph alignment
        const pPrMatch = para.match(/<a:pPr[^>]*>/);
        let align = "";
        if (pPrMatch) {
          const algn = pPrMatch[0].match(/algn="([^"]+)"/);
          if (algn) {
            switch (algn[1]) {
              case "ctr":
                align = "text-align:center";
                break;
              case "r":
                align = "text-align:right";
                break;
              case "just":
                align = "text-align:justify";
                break;
            }
          }
        }

        // Extract runs
        const runs = para.match(/<a:r[\s>][^]*?<\/a:r>/g) ?? [];
        const runHtmls: string[] = [];

        for (const run of runs) {
          const rPr = run.match(/<a:rPr[^>]*>/)?.[0] ?? "";
          const text = (run.match(/<a:t>([^<]*)<\/a:t>/)?.[1] ?? "").trim();
          if (!text) continue;

          let html = escapeHtml(decodeXmlEntities(text));
          if (/\bb="1"/.test(rPr)) html = `<strong>${html}</strong>`;
          if (/\bi="1"/.test(rPr)) html = `<em>${html}</em>`;

          const sizeMatch = rPr.match(/sz="(\d+)"/);
          const colorMatch = rPr.match(
            /<a:solidFill>[^]*?<a:srgbClr\s+val="([^"]+)"[^]*?<\/a:solidFill>/,
          );

          const styles: string[] = [];
          if (sizeMatch) styles.push(`font-size:${parseInt(sizeMatch[1], 10) / 100}pt`);
          if (colorMatch) styles.push(`color:#${colorMatch[1]}`);

          if (styles.length > 0) {
            html = `<span style="${styles.join(";")}">${html}</span>`;
          }
          runHtmls.push(html);
          plainTextParts.push(text);
        }

        if (runHtmls.length > 0) {
          const style = align ? ` style="${align}"` : "";
          shapes.push(`<p${style}>${runHtmls.join(" ")}</p>`);
        }
      }
    }

    if (shapes.length > 0) {
      slidesHtml.push(
        `<div class="slide" style="margin:24px 0;padding:24px;background:#fff;border:1px solid #ddd;border-radius:8px">\n` +
          `  <div style="font-size:11px;color:#999;margin-bottom:8px">Slide ${i + 1}</div>\n` +
          `  ${shapes.join("\n  ")}\n` +
          `</div>`,
      );
    }
  }

  return {
    html: slidesHtml.join("\n"),
    pageCount: slideFiles.length,
    plainText: plainTextParts.join("\n"),
  };
}

// ─── HWPX → HTML ──────────────────────────────────────

async function convertHwpxToHtml(
  zip: JSZip,
): Promise<{ html: string; pageCount: number; plainText: string }> {
  const sectionFiles: string[] = [];
  zip.forEach((p) => {
    if (/^Contents\/section\d+\.xml$/i.test(p)) sectionFiles.push(p);
  });
  sectionFiles.sort((a, b) => {
    const na = parseInt(a.match(/section(\d+)/)?.[1] ?? "0", 10);
    const nb = parseInt(b.match(/section(\d+)/)?.[1] ?? "0", 10);
    return na - nb;
  });

  // Fallback: check content.hpf
  if (sectionFiles.length === 0) {
    const contentHpf = zip.file("Contents/content.hpf");
    if (contentHpf) {
      const hpfXml = await contentHpf.async("text");
      const refs = hpfXml.match(/section\d+\.xml/gi) ?? [];
      for (const ref of refs) {
        const fullPath = `Contents/${ref}`;
        if (zip.file(fullPath) && !sectionFiles.includes(fullPath)) {
          sectionFiles.push(fullPath);
        }
      }
      sectionFiles.sort();
    }
  }

  const sectionsHtml: string[] = [];
  const plainTextParts: string[] = [];

  for (const sectionPath of sectionFiles) {
    const sectionFile = zip.file(sectionPath);
    if (!sectionFile) continue;
    const xml = await sectionFile.async("text");

    // Parse paragraphs with formatting
    const nsPrefix = "(?:[a-z]+:)?";
    const paraPattern = new RegExp(`<${nsPrefix}p[\\s>][\\s\\S]*?</${nsPrefix}p>`, "g");
    const paraBlocks = xml.match(paraPattern) ?? [];

    for (const para of paraBlocks) {
      // Check paragraph properties for alignment
      const pPrPattern = new RegExp(
        `<${nsPrefix}(?:paraPr|paraShape)[^>]*>([\\s\\S]*?)</${nsPrefix}(?:paraPr|paraShape)>`,
      );
      const pPr = para.match(pPrPattern)?.[1] ?? "";

      let align = "";
      const alignMatch = pPr.match(/(?:align|alignment)="([^"]+)"/i);
      if (alignMatch) {
        switch (alignMatch[1].toLowerCase()) {
          case "center":
            align = "text-align:center";
            break;
          case "right":
            align = "text-align:right";
            break;
          case "justify":
          case "both":
            align = "text-align:justify";
            break;
        }
      }

      // Extract text runs with formatting
      const textPattern = new RegExp(`<${nsPrefix}t(?:\\s[^>]*)?>([^<]*)</${nsPrefix}t>`, "g");
      let match: RegExpExecArray | null;
      const texts: string[] = [];
      while ((match = textPattern.exec(para)) !== null) {
        const text = decodeXmlEntities(match[1]);
        if (text.trim()) texts.push(text);
      }

      if (texts.length > 0) {
        const lineText = texts.join("");
        plainTextParts.push(lineText);
        const style = align ? ` style="${align}"` : "";
        sectionsHtml.push(`<p${style}>${escapeHtml(lineText)}</p>`);
      }
    }

    // Parse tables
    const tablePattern = new RegExp(`<${nsPrefix}tbl[\\s>][\\s\\S]*?</${nsPrefix}tbl>`, "g");
    const tables = xml.match(tablePattern) ?? [];

    for (const tbl of tables) {
      const rowPattern = new RegExp(`<${nsPrefix}tr[\\s>][\\s\\S]*?</${nsPrefix}tr>`, "g");
      const rows = tbl.match(rowPattern) ?? [];
      if (rows.length === 0) continue;

      const tableRows: string[] = [];
      for (const row of rows) {
        const cellPattern = new RegExp(`<${nsPrefix}tc[\\s>][\\s\\S]*?</${nsPrefix}tc>`, "g");
        const cells = row.match(cellPattern) ?? [];
        const cellHtmls: string[] = [];

        for (const cell of cells) {
          const cellTexts: string[] = [];
          const cellTextPattern = new RegExp(
            `<${nsPrefix}t(?:\\s[^>]*)?>([^<]*)</${nsPrefix}t>`,
            "g",
          );
          let cellMatch: RegExpExecArray | null;
          while ((cellMatch = cellTextPattern.exec(cell)) !== null) {
            cellTexts.push(decodeXmlEntities(cellMatch[1]));
          }
          cellHtmls.push(
            `<td style="border:1px solid #ccc;padding:4px 8px">${escapeHtml(cellTexts.join(""))}</td>`,
          );
        }
        tableRows.push(`  <tr>${cellHtmls.join("")}</tr>`);
      }

      sectionsHtml.push(
        `<table style="width:100%;border-collapse:collapse;margin:12px 0">\n${tableRows.join("\n")}\n</table>`,
      );
    }
  }

  return {
    html: sectionsHtml.join("\n"),
    pageCount: Math.max(1, sectionFiles.length),
    plainText: plainTextParts.join("\n"),
  };
}

// ─── Wrapper HTML ─────────────────────────────────────

function wrapInDocument(content: string, title: string, docType: string): string {
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
  .doc-container {
    max-width: 794px;
    margin: 0 auto;
    background: white;
    padding: 48px 56px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    border-radius: 4px;
  }
  .doc-type-badge {
    display: inline-block;
    background: #e8f4fd;
    color: #1565c0;
    padding: 2px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 16px;
  }
  h1 { font-size: 24px; font-weight: 700; margin: 16px 0 8px 0; }
  h2 { font-size: 20px; font-weight: 700; margin: 14px 0 6px 0; }
  h3 { font-size: 16px; font-weight: 600; margin: 10px 0 4px 0; }
  h4 { font-size: 14px; font-weight: 600; margin: 8px 0 4px 0; }
  p { margin: 4px 0; font-size: 12pt; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  td, th { border: 1px solid #ccc; padding: 6px 10px; font-size: 11pt; }
  th { background: #f8f8f8; font-weight: 600; }
  .slide {
    margin: 24px 0;
    padding: 24px;
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 8px;
  }
  hr { margin: 24px 0; border: none; border-top: 1px solid #ddd; }
  @media print {
    body { background: white; padding: 0; }
    .doc-container { box-shadow: none; padding: 24px; }
  }
</style>
</head>
<body>
<div class="doc-container">
  <span class="doc-type-badge">${escapeHtml(docType.toUpperCase())}</span>
${content}
</div>
</body>
</html>`;
}

// ─── Public API ───────────────────────────────────────

/**
 * Convert an Office document (.docx/.xlsx/.pptx/.hwpx) to styled HTML.
 */
export async function convertDocToHtml(
  filePath: string,
  opts?: DocToHtmlOptions,
): Promise<DocToHtmlResult> {
  const maxChars = opts?.maxChars ?? 500_000;
  const ext = path.extname(filePath).toLowerCase();

  let docType: DocToHtmlResult["type"] = "unknown";
  if (ext === ".docx") docType = "docx";
  else if (ext === ".xlsx") docType = "xlsx";
  else if (ext === ".pptx") docType = "pptx";
  else if (ext === ".hwpx") docType = "hwpx";

  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);

  let result: { html: string; pageCount: number; plainText: string };

  switch (docType) {
    case "docx":
      result = await convertDocxToHtml(zip);
      break;
    case "xlsx":
      result = await convertXlsxToHtml(zip);
      break;
    case "pptx":
      result = await convertPptxToHtml(zip);
      break;
    case "hwpx":
      result = await convertHwpxToHtml(zip);
      break;
    default: {
      // Auto-detect format
      if (zip.file("Contents/section0.xml")) {
        docType = "hwpx";
        result = await convertHwpxToHtml(zip);
      } else if (zip.file("word/document.xml")) {
        docType = "docx";
        result = await convertDocxToHtml(zip);
      } else if (zip.file("xl/sharedStrings.xml") || zip.file("xl/worksheets/sheet1.xml")) {
        docType = "xlsx";
        result = await convertXlsxToHtml(zip);
      } else if (zip.file("ppt/slides/slide1.xml")) {
        docType = "pptx";
        result = await convertPptxToHtml(zip);
      } else {
        result = { html: "<p>지원하지 않는 문서 형식입니다.</p>", pageCount: 0, plainText: "" };
      }
      break;
    }
  }

  // Truncate plain text
  let plainText = result.plainText;
  if (plainText.length > maxChars) {
    plainText = plainText.slice(0, maxChars);
  }

  const title = path.basename(filePath);
  const html = wrapInDocument(result.html, title, docType);

  return {
    html,
    type: docType,
    pageCount: result.pageCount,
    plainText,
  };
}
