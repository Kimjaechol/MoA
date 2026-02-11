import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/slides/generate
 *
 * AI-powered slide generation from HTML content.
 * Takes document HTML and returns structured slide data optimized
 * for presentation: summarized content, keyword-focused bullets,
 * story flow, and image suggestions.
 *
 * In production, this calls the MoA gateway's LLM for summarization.
 * Falls back to smart extraction when no LLM is available.
 *
 * Body: { html, title, maxSlides?, theme? }
 */

interface SlideData {
  type: "title" | "content" | "section" | "two-column" | "image" | "table" | "summary";
  title: string;
  subtitle?: string;
  bullets?: string[];
  leftBullets?: string[];
  rightBullets?: string[];
  imageUrl?: string;
  imageCaption?: string;
  tableData?: string[][];
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { html, title, maxSlides = 15 } = body;

    if (!html || typeof html !== "string") {
      return NextResponse.json(
        { error: "html content is required" },
        { status: 400 },
      );
    }

    // Build the LLM prompt for slide generation
    const systemPrompt = buildSystemPrompt(maxSlides);
    const userPrompt = buildUserPrompt(html, title, maxSlides);

    // Try calling the MoA gateway LLM
    const llmResponse = await callLlm(systemPrompt, userPrompt);

    if (llmResponse) {
      try {
        const slides = JSON.parse(llmResponse) as SlideData[];
        return NextResponse.json({ slides, source: "ai" });
      } catch {
        // LLM returned non-JSON, fallback to extraction
      }
    }

    // Fallback: server-side smart extraction
    const slides = serverSideExtract(html, title, maxSlides);
    return NextResponse.json({ slides, source: "extraction" });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

function buildSystemPrompt(maxSlides: number): string {
  return `You are an expert presentation designer. Given HTML document content,
create a structured JSON array of slide data for a professional presentation.

Rules:
- Maximum ${maxSlides} slides
- First slide is always type "title" with the document title
- Last slide is always type "summary" with key takeaways
- Use "section" type for major topic transitions
- Use "content" type for bullet-point slides (max 5 bullets per slide)
- Use "table" type when data tables are present
- Keep bullets SHORT (under 60 characters) — keywords and phrases, not full sentences
- Create a logical story flow: introduction → main points → details → conclusion
- Include speaker notes with the full context for each slide
- Generate image suggestions in imageCaption when visual aids would help

Return ONLY a valid JSON array of slide objects. Each slide has:
{
  "type": "title" | "content" | "section" | "two-column" | "table" | "summary",
  "title": "string",
  "subtitle": "string (optional)",
  "bullets": ["string array (optional)"],
  "tableData": [["2D string array (optional)"]],
  "notes": "string (optional speaker notes)"
}`;
}

function buildUserPrompt(html: string, title: string, maxSlides: number): string {
  // Strip HTML tags for LLM — preserve structure markers
  const cleanText = html
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n## $1\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<tr[^>]*>(.*?)<\/tr>/gi, "| $1 |\n")
    .replace(/<t[dh][^>]*>(.*?)<\/t[dh]>/gi, " $1 |")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Truncate if too long (LLM context limit)
  const truncated = cleanText.length > 8000 ? cleanText.slice(0, 8000) + "\n\n[... content truncated ...]" : cleanText;

  return `Create a ${maxSlides}-slide presentation titled "${title}" from this document:\n\n${truncated}`;
}

/**
 * Call the MoA gateway LLM for AI-powered summarization.
 * Returns null if no LLM is available.
 */
async function callLlm(systemPrompt: string, userPrompt: string): Promise<string | null> {
  // Check for available LLM endpoints
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (anthropicKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.content?.[0]?.text ?? null;
      }
    } catch {
      // Fall through to next provider
    }
  }

  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 4096,
          temperature: 0.7,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? null;
      }
    } catch {
      // Fall through
    }
  }

  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      }
    } catch {
      // Fall through
    }
  }

  return null;
}

/**
 * Server-side smart extraction fallback.
 * Parses HTML structure and creates slides without an LLM.
 */
function serverSideExtract(html: string, title: string, maxSlides: number): SlideData[] {
  const slides: SlideData[] = [];

  // Simple regex-based extraction (no DOM available on server)
  const headingPattern = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const pPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const liPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;

  // Title slide
  slides.push({
    type: "title",
    title,
    subtitle: "AI-Generated Presentation",
    notes: "Generated by MoA Document Editor",
  });

  // Extract headings and their following content
  const parts: Array<{ level: number; title: string; content: string }> = [];
  let lastIdx = 0;

  let headingMatch;
  while ((headingMatch = headingPattern.exec(html)) !== null) {
    const level = parseInt(headingMatch[1], 10);
    const headingText = stripHtmlTags(headingMatch[2]);
    const startAfterHeading = headingMatch.index + headingMatch[0].length;

    // Save previous section's content
    if (parts.length > 0) {
      parts[parts.length - 1].content = html.slice(lastIdx, headingMatch.index);
    }

    parts.push({ level, title: headingText, content: "" });
    lastIdx = startAfterHeading;
  }
  if (parts.length > 0) {
    parts[parts.length - 1].content = html.slice(lastIdx);
  }

  // Convert parts to slides
  for (const part of parts) {
    if (slides.length >= maxSlides - 1) break;

    // Section slide for H1/H2
    if (part.level <= 2) {
      slides.push({
        type: "section",
        title: part.title,
      });
    }

    // Extract bullets from content
    const bullets: string[] = [];
    let liMatch;
    const liRe = new RegExp(liPattern.source, "gi");
    while ((liMatch = liRe.exec(part.content)) !== null) {
      const text = stripHtmlTags(liMatch[1]).trim();
      if (text && text.length > 3) bullets.push(trimBullet(text));
    }

    // Extract from paragraphs if no list items
    if (bullets.length === 0) {
      let pMatch;
      const pRe = new RegExp(pPattern.source, "gi");
      while ((pMatch = pRe.exec(part.content)) !== null) {
        const text = stripHtmlTags(pMatch[1]).trim();
        if (text && text.length > 10) bullets.push(trimBullet(text));
      }
    }

    if (bullets.length > 0 && slides.length < maxSlides - 1) {
      // Chunk into slides of 5 bullets
      for (let i = 0; i < bullets.length; i += 5) {
        if (slides.length >= maxSlides - 1) break;
        slides.push({
          type: "content",
          title: part.title,
          bullets: bullets.slice(i, i + 5),
        });
      }
    }

    // Tables
    let tableMatch;
    const tableRe = new RegExp(tablePattern.source, "gi");
    while ((tableMatch = tableRe.exec(part.content)) !== null) {
      if (slides.length >= maxSlides - 1) break;
      const rows = extractTableRows(tableMatch[1]);
      if (rows.length > 0) {
        slides.push({
          type: "table",
          title: part.title,
          tableData: rows.slice(0, 8),
        });
      }
    }
  }

  // Summary slide
  const sectionTitles = parts
    .filter((p) => p.title && p.level <= 3)
    .map((p) => p.title)
    .slice(0, 6);

  slides.push({
    type: "summary",
    title: "Summary",
    subtitle: title,
    bullets: sectionTitles.length > 0 ? sectionTitles : ["Key points from the document"],
  });

  return slides;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function trimBullet(text: string): string {
  if (text.length <= 80) return text;
  const cut = text.lastIndexOf(" ", 80);
  return (cut > 30 ? text.slice(0, cut) : text.slice(0, 80)) + "...";
}

function extractTableRows(tableContent: string): string[][] {
  const rows: string[][] = [];
  const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trPattern.exec(tableContent)) !== null) {
    const cells: string[] = [];
    const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(trMatch[1])) !== null) {
      cells.push(stripHtmlTags(cellMatch[1]).trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}
