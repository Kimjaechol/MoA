import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/synthesis
 *
 * Multi-document synthesis: takes multiple source documents,
 * combines them using LLM large context windows, and generates
 * a comprehensive new document.
 *
 * Body: { sources: [{name, content}], format, length, language, instructions }
 */

interface SourceInput {
  name: string;
  content: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      sources,
      format = "report",
      length = "medium",
      language = "ko",
      instructions = "",
    } = body as {
      sources: SourceInput[];
      format: string;
      length: string;
      language: string;
      instructions: string;
    };

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return NextResponse.json({ error: "At least one source document is required" }, { status: 400 });
    }

    // Build synthesis prompt
    const systemPrompt = buildSystemPrompt(format, length, language, instructions);
    const userPrompt = buildUserPrompt(sources, format);

    // Try LLM synthesis
    const llmResult = await callSynthesisLlm(systemPrompt, userPrompt);

    if (llmResult) {
      const title = extractTitle(llmResult, format, language);
      return NextResponse.json({
        title,
        content: llmResult,
        model: llmResult.length > 0 ? detectModelUsed() : "fallback",
        source: "ai",
      });
    }

    // Fallback: simple merge
    const merged = fallbackMerge(sources, format, language);
    return NextResponse.json({
      title: merged.title,
      content: merged.content,
      model: "fallback/merge",
      source: "extraction",
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function buildSystemPrompt(format: string, length: string, language: string, instructions: string): string {
  const formatDescriptions: Record<string, string> = {
    report: "a comprehensive analytical report with sections, data synthesis, and conclusions",
    summary: "a concise summary highlighting key points from all sources",
    comparison: "a comparative analysis table/document showing similarities and differences",
    proposal: "a business proposal/plan document with structured sections",
    essay: "an academic essay with thesis, arguments, evidence, and conclusion",
    brief: "a brief executive summary with only the most critical information",
  };

  const lengthGuide: Record<string, string> = {
    short: "1-2 pages (500-1000 words)",
    medium: "3-5 pages (1500-3000 words)",
    long: "5+ pages (3000-6000 words)",
  };

  const langName = language === "ko" ? "Korean" : language === "en" ? "English" : "the same language as the source materials";

  return `You are an expert document synthesis specialist. Your task is to create ${formatDescriptions[format] ?? "a comprehensive document"}.

Requirements:
- Output length: ${lengthGuide[length] ?? lengthGuide.medium}
- Language: Write in ${langName}
- Combine and cross-reference information from ALL provided sources
- Identify key themes, contradictions, and complementary information
- Structure the output with clear headings and sections
- Include citations/references to source documents where appropriate
- Maintain objectivity and accuracy
${instructions ? `\nAdditional instructions: ${instructions}` : ""}

Output only the document content in plain text with markdown formatting.`;
}

function buildUserPrompt(sources: SourceInput[], format: string): string {
  const sourcesText = sources.map((s, i) => {
    const truncated = s.content.length > 15000 ? s.content.slice(0, 15000) + "\n[... truncated ...]" : s.content;
    return `=== Source ${i + 1}: ${s.name} ===\n${truncated}`;
  }).join("\n\n");

  const totalChars = sources.reduce((sum, s) => sum + s.content.length, 0);

  return `Please synthesize the following ${sources.length} source documents (total ${totalChars.toLocaleString()} characters) into a ${format}:\n\n${sourcesText}`;
}

async function callSynthesisLlm(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Prefer Claude for synthesis (200K context window)
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
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.content?.[0]?.text ?? null;
      }
    } catch { /* fall through */ }
  }

  // OpenAI fallback (128K context)
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
          max_tokens: 8192,
          temperature: 0.7,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? null;
      }
    } catch { /* fall through */ }
  }

  // Gemini fallback (2M context window!)
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { maxOutputTokens: 8192, temperature: 0.7 },
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      }
    } catch { /* fall through */ }
  }

  return null;
}

function detectModelUsed(): string {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic/claude-sonnet-4-5";
  if (process.env.OPENAI_API_KEY) return "openai/gpt-4o";
  if (process.env.GEMINI_API_KEY) return "gemini/gemini-2.0-flash";
  return "fallback";
}

function extractTitle(content: string, format: string, language: string): string {
  // Try to extract first heading from content
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();

  const formatTitles: Record<string, Record<string, string>> = {
    ko: {
      report: "종합 분석 보고서",
      summary: "핵심 요약문",
      comparison: "비교 분석 보고서",
      proposal: "기획 제안서",
      essay: "종합 에세이",
      brief: "브리핑 자료",
    },
    en: {
      report: "Comprehensive Analysis Report",
      summary: "Executive Summary",
      comparison: "Comparative Analysis",
      proposal: "Business Proposal",
      essay: "Synthesis Essay",
      brief: "Executive Brief",
    },
  };

  const lang = language === "auto" ? "ko" : language;
  return formatTitles[lang]?.[format] ?? formatTitles.ko.report;
}

function fallbackMerge(sources: SourceInput[], format: string, language: string): { title: string; content: string } {
  const isKo = language !== "en";
  const title = isKo ? "종합 문서 (자동 병합)" : "Merged Document";

  const sections = sources.map((s, i) => {
    const heading = isKo ? `## 자료 ${i + 1}: ${s.name}` : `## Source ${i + 1}: ${s.name}`;
    const preview = s.content.slice(0, 3000);
    return `${heading}\n\n${preview}${s.content.length > 3000 ? "\n\n..." : ""}`;
  });

  const intro = isKo
    ? `# ${title}\n\n이 문서는 ${sources.length}개의 자료를 병합하여 생성되었습니다.\nAI 요약 기능을 사용하려면 API 키를 마이페이지에서 설정해주세요.\n\n---\n\n`
    : `# ${title}\n\nThis document was generated by merging ${sources.length} sources.\nTo use AI synthesis, configure your API key in MyPage.\n\n---\n\n`;

  return { title, content: intro + sections.join("\n\n---\n\n") };
}
