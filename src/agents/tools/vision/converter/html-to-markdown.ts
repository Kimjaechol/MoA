/**
 * HTML → Markdown Converter
 *
 * Converts styled HTML (from the PDF/document converters) to Markdown
 * preserving structure:
 *   - Headings (h1-h6)
 *   - Bold, italic, inline code
 *   - Tables
 *   - Lists (ordered and unordered)
 *   - Links and images
 *   - Horizontal rules
 *   - Paragraphs with line breaks
 */

export interface HtmlToMarkdownOptions {
  /** Use GFM-style tables. Default true. */
  gfmTables?: boolean;
  /** Maximum line width for wrapping. 0 = no wrap. Default 0. */
  maxLineWidth?: number;
}

/**
 * Simple HTML → Markdown conversion.
 *
 * This is a lightweight regex-based converter designed for the structured
 * HTML output from our PDF/document converters, not a full HTML parser.
 */
export function convertHtmlToMarkdown(html: string, opts?: HtmlToMarkdownOptions): string {
  // Remove doctype, html, head, body wrappers
  let content = html
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<html[^>]*>/gi, "")
    .replace(/<\/html>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<body[^>]*>/gi, "")
    .replace(/<\/body>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");

  // Remove div/span wrappers but keep their content
  content = content
    .replace(/<div[^>]*class="pdf-page"[^>]*>/gi, "\n---\n\n")
    .replace(/<div[^>]*class="doc-container"[^>]*>/gi, "")
    .replace(/<div[^>]*class="page-number"[^>]*>[^<]*<\/div>/gi, "")
    .replace(/<div[^>]*class="doc-type-badge"[^>]*>[^<]*<\/div>/gi, "")
    .replace(/<span[^>]*class="doc-type-badge"[^>]*>[^<]*<\/span>/gi, "");

  // Process tables first (before removing tags)
  content = convertTables(content);

  // Headings
  content = content.replace(
    /<h1[^>]*>([\s\S]*?)<\/h1>/gi,
    (_m, text) => `\n# ${stripTags(text).trim()}\n`,
  );
  content = content.replace(
    /<h2[^>]*>([\s\S]*?)<\/h2>/gi,
    (_m, text) => `\n## ${stripTags(text).trim()}\n`,
  );
  content = content.replace(
    /<h3[^>]*>([\s\S]*?)<\/h3>/gi,
    (_m, text) => `\n### ${stripTags(text).trim()}\n`,
  );
  content = content.replace(
    /<h4[^>]*>([\s\S]*?)<\/h4>/gi,
    (_m, text) => `\n#### ${stripTags(text).trim()}\n`,
  );
  content = content.replace(
    /<h5[^>]*>([\s\S]*?)<\/h5>/gi,
    (_m, text) => `\n##### ${stripTags(text).trim()}\n`,
  );
  content = content.replace(
    /<h6[^>]*>([\s\S]*?)<\/h6>/gi,
    (_m, text) => `\n###### ${stripTags(text).trim()}\n`,
  );

  // Bold and italic
  content = content.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  content = content.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  content = content.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  content = content.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");

  // Underline → bold (Markdown has no underline)
  content = content.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, "**$1**");

  // Strikethrough
  content = content.replace(/<s[^>]*>([\s\S]*?)<\/s>/gi, "~~$1~~");
  content = content.replace(/<strike[^>]*>([\s\S]*?)<\/strike>/gi, "~~$1~~");
  content = content.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~");

  // Code
  content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  content = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

  // Links
  content = content.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  // Images
  content = content.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  content = content.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  // Lists
  content = convertLists(content);

  // Line breaks
  content = content.replace(/<br\s*\/?>/gi, "  \n");

  // Horizontal rules
  content = content.replace(/<hr[^>]*\/?>/gi, "\n---\n");

  // Paragraphs
  content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, text) => {
    const stripped = stripTags(text).trim();
    return stripped ? `\n${stripped}\n` : "\n";
  });

  // Remove remaining HTML tags
  content = stripTags(content);

  // Decode HTML entities
  content = decodeEntities(content);

  // Clean up whitespace
  content = content
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "\n");

  return content;
}

/**
 * Convert HTML tables to GFM Markdown tables.
 */
function convertTables(html: string): string {
  const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;

  return html.replace(tablePattern, (_m, tableContent) => {
    const rows: string[][] = [];
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowPattern.exec(tableContent)) !== null) {
      const cellPattern = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;

      while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
        cells.push(stripTags(cellMatch[1]).trim().replace(/\|/g, "\\|"));
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length === 0) return "";

    // Normalize column count
    const maxCols = Math.max(...rows.map((r) => r.length));
    const normalizedRows = rows.map((r) => {
      while (r.length < maxCols) r.push("");
      return r;
    });

    // Build markdown table
    const lines: string[] = [];
    // Header row
    lines.push(`| ${normalizedRows[0].join(" | ")} |`);
    // Separator
    lines.push(`| ${normalizedRows[0].map(() => "---").join(" | ")} |`);
    // Data rows
    for (let i = 1; i < normalizedRows.length; i++) {
      lines.push(`| ${normalizedRows[i].join(" | ")} |`);
    }

    return `\n${lines.join("\n")}\n`;
  });
}

/**
 * Convert HTML lists to Markdown.
 */
function convertLists(html: string): string {
  // Unordered lists
  html = html.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, content) => {
    const items = content.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) ?? [];
    const mdItems = items.map((item: string) => {
      const text = stripTags(item.replace(/<li[^>]*>/i, "").replace(/<\/li>/i, "")).trim();
      return `- ${text}`;
    });
    return `\n${mdItems.join("\n")}\n`;
  });

  // Ordered lists
  html = html.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, content) => {
    const items = content.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) ?? [];
    const mdItems = items.map((item: string, i: number) => {
      const text = stripTags(item.replace(/<li[^>]*>/i, "").replace(/<\/li>/i, "")).trim();
      return `${i + 1}. ${text}`;
    });
    return `\n${mdItems.join("\n")}\n`;
  });

  return html;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/g, " ");
}
