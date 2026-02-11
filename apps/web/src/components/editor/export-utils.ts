/**
 * Document Export Utilities
 *
 * Export HTML editor content to various formats:
 *   - HTML (.html)
 *   - Markdown (.md)
 *   - Plain Text (.txt)
 *   - PDF (via print)
 *   - DOCX (.docx) — using docx library
 *   - HWPX (.hwpx) — using JSZip to create OWPML
 *   - XLSX (.xlsx) — using JSZip for tables/forms
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";
import { saveAs } from "file-saver";
import JSZip from "jszip";

/** Parse HTML into a simple DOM-like structure for conversion. */
function parseHtmlContent(html: string): HTMLElement {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return doc.body;
}

// ─── HTML Export ──────────────────────────────────────

export function exportAsHtml(html: string, title: string) {
  const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
body {
  font-family: "Malgun Gothic", "맑은 고딕", -apple-system, sans-serif;
  max-width: 794px;
  margin: 0 auto;
  padding: 48px 56px;
  line-height: 1.6;
  color: #222;
}
table { border-collapse: collapse; width: 100%; margin: 12px 0; }
td, th { border: 1px solid #ccc; padding: 6px 10px; }
th { background: #f8f8f8; font-weight: 600; }
img { max-width: 100%; height: auto; }
blockquote { border-left: 3px solid #ddd; margin: 8px 0; padding: 8px 16px; color: #555; }
pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }
code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-family: monospace; }
hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
</style>
</head>
<body>
${html}
</body>
</html>`;

  downloadFile(fullHtml, `${title}.html`, "text/html;charset=utf-8");
}

// ─── Markdown Export ─────────────────────────────────

export function exportAsMarkdown(html: string, title: string) {
  let md = html;

  // Tables
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, content) => {
    const rows: string[][] = [];
    const rowMatches = content.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const rm of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rm[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi);
      for (const cm of cellMatches) {
        cells.push(stripTags(cm[1]).trim().replace(/\|/g, "\\|"));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return "";
    const maxCols = Math.max(...rows.map((r) => r.length));
    const normalized = rows.map((r) => {
      while (r.length < maxCols) r.push("");
      return r;
    });
    const lines: string[] = [];
    lines.push(`| ${normalized[0].join(" | ")} |`);
    lines.push(`| ${normalized[0].map(() => "---").join(" | ")} |`);
    for (let i = 1; i < normalized.length; i++) {
      lines.push(`| ${normalized[i].join(" | ")} |`);
    }
    return `\n${lines.join("\n")}\n`;
  });

  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${stripTags(t).trim()}\n`);
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${stripTags(t).trim()}\n`);
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${stripTags(t).trim()}\n`);
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n#### ${stripTags(t).trim()}\n`);
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, "__$1__");
  md = md.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, "~~$1~~");
  md = md.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~");
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => `\n> ${stripTags(t).trim()}\n`);
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");
  md = md.replace(/<br\s*\/?>/gi, "  \n");
  md = md.replace(/<hr[^>]*\/?>/gi, "\n---\n");
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${stripTags(t).trim()}\n`);
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${stripTags(t).trim()}\n`);
  md = md.replace(/<[^>]+>/g, "");
  md = md.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  md = md.replace(/\n{3,}/g, "\n\n").trim() + "\n";

  downloadFile(md, `${title}.md`, "text/markdown;charset=utf-8");
}

// ─── Plain Text Export ───────────────────────────────

export function exportAsText(text: string, title: string) {
  downloadFile(text, `${title}.txt`, "text/plain;charset=utf-8");
}

// ─── PDF Export ──────────────────────────────────────

export function exportAsPdf() {
  window.print();
}

// ─── DOCX Export ─────────────────────────────────────

export async function exportAsDocx(html: string, title: string) {
  const body = parseHtmlContent(html);
  const children: (Paragraph | Table)[] = [];

  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === "table") {
        const table = htmlTableToDocx(el);
        if (table) children.push(table);
      } else if (tag.match(/^h[1-6]$/)) {
        const level = parseInt(tag[1], 10);
        children.push(
          new Paragraph({
            heading: level === 1 ? HeadingLevel.HEADING_1 :
                     level === 2 ? HeadingLevel.HEADING_2 :
                     level === 3 ? HeadingLevel.HEADING_3 :
                     HeadingLevel.HEADING_4,
            children: htmlInlineToDocxRuns(el),
            alignment: getDocxAlignment(el),
          }),
        );
      } else if (tag === "blockquote") {
        children.push(
          new Paragraph({
            children: htmlInlineToDocxRuns(el),
            indent: { left: 720 },
          }),
        );
      } else if (tag === "hr") {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: "─".repeat(60), color: "CCCCCC" })],
          }),
        );
      } else if (tag === "ul" || tag === "ol") {
        const items = el.querySelectorAll("li");
        items.forEach((li, idx) => {
          const prefix = tag === "ol" ? `${idx + 1}. ` : "• ";
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: prefix }),
                ...htmlInlineToDocxRuns(li),
              ],
              indent: { left: 360 },
            }),
          );
        });
      } else {
        // Default: paragraph
        const runs = htmlInlineToDocxRuns(el);
        if (runs.length > 0) {
          children.push(
            new Paragraph({
              children: runs,
              alignment: getDocxAlignment(el),
            }),
          );
        }
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        children.push(new Paragraph({ children: [new TextRun(text)] }));
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: children.length > 0 ? children : [new Paragraph({ children: [new TextRun("")] })],
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${title}.docx`);
}

function htmlInlineToDocxRuns(el: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];

  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) runs.push(new TextRun({ text }));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;
      const tag = childEl.tagName.toLowerCase();
      const text = childEl.textContent ?? "";

      const props: Record<string, unknown> = { text };

      if (tag === "strong" || tag === "b") props.bold = true;
      if (tag === "em" || tag === "i") props.italics = true;
      if (tag === "u") props.underline = {};
      if (tag === "s" || tag === "del") props.strike = true;

      const style = childEl.getAttribute("style") ?? "";
      const colorMatch = style.match(/color:\s*#([0-9a-fA-F]{6})/);
      if (colorMatch) props.color = colorMatch[1];

      const sizeMatch = style.match(/font-size:\s*(\d+)px/);
      if (sizeMatch) props.size = parseInt(sizeMatch[1], 10) * 2; // half-points

      const fontMatch = style.match(/font-family:\s*"?([^";]+)/);
      if (fontMatch) props.font = fontMatch[1].trim();

      if (tag === "br") {
        runs.push(new TextRun({ text: "", break: 1 }));
      } else {
        runs.push(new TextRun(props as ConstructorParameters<typeof TextRun>[0]));
      }
    }
  }

  return runs;
}

function htmlTableToDocx(tableEl: HTMLElement): Table | null {
  const rows: TableRow[] = [];
  const trEls = tableEl.querySelectorAll("tr");

  for (const tr of Array.from(trEls)) {
    const cells: TableCell[] = [];
    const cellEls = tr.querySelectorAll("td, th");

    for (const cellEl of Array.from(cellEls)) {
      cells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: cellEl.textContent?.trim() ?? "", bold: cellEl.tagName === "TH" })],
            }),
          ],
          width: { size: 100 / cellEls.length, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
          },
        }),
      );
    }

    if (cells.length > 0) {
      rows.push(new TableRow({ children: cells }));
    }
  }

  if (rows.length === 0) return null;

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function getDocxAlignment(el: HTMLElement): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const style = el.getAttribute("style") ?? "";
  if (style.includes("text-align: center") || style.includes("text-align:center")) return AlignmentType.CENTER;
  if (style.includes("text-align: right") || style.includes("text-align:right")) return AlignmentType.RIGHT;
  if (style.includes("text-align: justify") || style.includes("text-align:justify")) return AlignmentType.JUSTIFIED;
  return undefined;
}

// ─── HWPX Export ─────────────────────────────────────

export async function exportAsHwpx(html: string, title: string) {
  const body = parseHtmlContent(html);
  const zip = new JSZip();

  // HWPX structure: OWPML-based ZIP
  const sectionXml = buildHwpxSection(body);

  // version.xml
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?>
<hv:version xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version">
  <hv:application version="1.0">MoA Document Editor</hv:application>
</hv:version>`);

  // META-INF/manifest.xml
  zip.folder("META-INF")?.file("manifest.xml", `<?xml version="1.0" encoding="UTF-8"?>
<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/>
  <odf:file-entry odf:full-path="Contents/section0.xml" odf:media-type="application/xml"/>
  <odf:file-entry odf:full-path="Contents/content.hpf" odf:media-type="application/xml"/>
</odf:manifest>`);

  // Contents/content.hpf
  zip.folder("Contents")?.file("content.hpf", `<?xml version="1.0" encoding="UTF-8"?>
<hpf:content xmlns:hpf="http://www.hancom.co.kr/hwpml/2011/content">
  <hpf:section href="section0.xml"/>
</hpf:content>`);

  // Contents/section0.xml
  zip.folder("Contents")?.file("section0.xml", sectionXml);

  // mimetype (uncompressed)
  zip.file("mimetype", "application/hwp+zip");

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  saveAs(blob, `${title}.hwpx`);
}

function buildHwpxSection(body: HTMLElement): string {
  const paragraphs: string[] = [];

  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === "table") {
        // Convert table to HWPX table
        const tableXml = buildHwpxTable(el);
        paragraphs.push(tableXml);
      } else {
        // Extract text with basic formatting info
        const text = el.textContent?.trim() ?? "";
        if (text) {
          const style = el.getAttribute("style") ?? "";
          let align = "left";
          if (style.includes("center")) align = "center";
          else if (style.includes("right")) align = "right";
          else if (style.includes("justify")) align = "both";

          paragraphs.push(
            `    <hp:p>\n` +
            `      <hp:paraPr>\n` +
            `        <hp:align val="${align}"/>\n` +
            `      </hp:paraPr>\n` +
            `      <hp:run>\n` +
            `        <hp:t>${escapeXml(text)}</hp:t>\n` +
            `      </hp:run>\n` +
            `    </hp:p>`,
          );
        }
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) {
        paragraphs.push(
          `    <hp:p>\n` +
          `      <hp:run>\n` +
          `        <hp:t>${escapeXml(text)}</hp:t>\n` +
          `      </hp:run>\n` +
          `    </hp:p>`,
        );
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"
        xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section">
${paragraphs.join("\n")}
</hp:sec>`;
}

function buildHwpxTable(tableEl: HTMLElement): string {
  const rows: string[] = [];
  const trEls = tableEl.querySelectorAll("tr");

  for (const tr of Array.from(trEls)) {
    const cells: string[] = [];
    const cellEls = tr.querySelectorAll("td, th");

    for (const cellEl of Array.from(cellEls)) {
      const text = cellEl.textContent?.trim() ?? "";
      cells.push(
        `        <hp:tc>\n` +
        `          <hp:p>\n` +
        `            <hp:run>\n` +
        `              <hp:t>${escapeXml(text)}</hp:t>\n` +
        `            </hp:run>\n` +
        `          </hp:p>\n` +
        `        </hp:tc>`,
      );
    }

    rows.push(
      `      <hp:tr>\n${cells.join("\n")}\n      </hp:tr>`,
    );
  }

  return `    <hp:tbl>\n${rows.join("\n")}\n    </hp:tbl>`;
}

// ─── XLSX Export ─────────────────────────────────────

export async function exportAsXlsx(html: string, title: string) {
  const body = parseHtmlContent(html);
  const zip = new JSZip();

  // Collect all table data, or create single-cell content
  const tables = body.querySelectorAll("table");
  const sharedStrings: string[] = [];
  const ssMap = new Map<string, number>();

  function addSharedString(str: string): number {
    const existing = ssMap.get(str);
    if (existing !== undefined) return existing;
    const idx = sharedStrings.length;
    sharedStrings.push(str);
    ssMap.set(str, idx);
    return idx;
  }

  // Build sheet data from tables or from text paragraphs
  const sheets: Array<{ name: string; rows: string[][] }> = [];

  if (tables.length > 0) {
    tables.forEach((table, idx) => {
      const rows: string[][] = [];
      table.querySelectorAll("tr").forEach((tr) => {
        const cells: string[] = [];
        tr.querySelectorAll("td, th").forEach((cell) => {
          cells.push(cell.textContent?.trim() ?? "");
        });
        rows.push(cells);
      });
      sheets.push({ name: `Sheet${idx + 1}`, rows });
    });
  } else {
    // No tables — put text content as rows
    const rows: string[][] = [];
    body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li").forEach((el) => {
      const text = el.textContent?.trim();
      if (text) rows.push([text]);
    });
    if (rows.length === 0) rows.push([body.textContent?.trim() ?? ""]);
    sheets.push({ name: "Sheet1", rows });
  }

  // [Content_Types].xml
  let sheetContentTypes = "";
  sheets.forEach((_, i) => {
    sheetContentTypes += `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  });

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheetContentTypes}
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`);

  // _rels/.rels
  zip.folder("_rels")?.file(".rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

  // xl/_rels/workbook.xml.rels
  let sheetRels = "";
  sheets.forEach((_, i) => {
    sheetRels += `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`;
  });
  sheetRels += `<Relationship Id="rIdSS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`;

  zip.folder("xl")?.folder("_rels")?.file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRels}
</Relationships>`);

  // xl/workbook.xml
  let sheetDefs = "";
  sheets.forEach((sheet, i) => {
    sheetDefs += `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`;
  });

  zip.folder("xl")?.file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetDefs}</sheets>
</workbook>`);

  // Sheets
  for (let si = 0; si < sheets.length; si++) {
    const sheet = sheets[si];
    let sheetData = "";

    for (let r = 0; r < sheet.rows.length; r++) {
      let rowData = "";
      for (let c = 0; c < sheet.rows[r].length; c++) {
        const val = sheet.rows[r][c];
        const cellRef = `${String.fromCharCode(65 + c)}${r + 1}`;

        // Check if numeric
        if (val && !isNaN(Number(val)) && val.trim() !== "") {
          rowData += `<c r="${cellRef}"><v>${val}</v></c>`;
        } else {
          const ssIdx = addSharedString(val);
          rowData += `<c r="${cellRef}" t="s"><v>${ssIdx}</v></c>`;
        }
      }
      sheetData += `<row r="${r + 1}">${rowData}</row>`;
    }

    zip.folder("xl")?.folder("worksheets")?.file(`sheet${si + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetData}</sheetData>
</worksheet>`);
  }

  // xl/sharedStrings.xml
  let ssItems = "";
  for (const str of sharedStrings) {
    ssItems += `<si><t>${escapeXml(str)}</t></si>`;
  }

  zip.folder("xl")?.file("sharedStrings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
  ${ssItems}
</sst>`);

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, `${title}.xlsx`);
}

// ─── Helpers ─────────────────────────────────────────

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  saveAs(blob, filename);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}
