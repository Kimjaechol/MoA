/**
 * Real-time Interpreter API Endpoint
 *
 * Provides text-based interpretation using Gemini 2.5 Flash.
 * For voice-based real-time interpretation, use the desktop/mobile app.
 *
 * POST /api/interpreter
 * Body: { text, source_lang, target_lang, user_id, mode?, domain? }
 *
 * GET /api/interpreter
 * Returns: supported languages and language pairs
 */

import { NextRequest, NextResponse } from "next/server";

// Supported languages with native names
const SUPPORTED_LANGUAGES: Record<string, { name: string; nativeName: string; flag: string }> = {
  ko: { name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  en: { name: "English", nativeName: "English", flag: "🇺🇸" },
  ja: { name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  zh: { name: "Chinese (Simplified)", nativeName: "中文", flag: "🇨🇳" },
  "zh-TW": { name: "Chinese (Traditional)", nativeName: "繁體中文", flag: "🇹🇼" },
  es: { name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  fr: { name: "French", nativeName: "Français", flag: "🇫🇷" },
  de: { name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  it: { name: "Italian", nativeName: "Italiano", flag: "🇮🇹" },
  pt: { name: "Portuguese", nativeName: "Português", flag: "🇧🇷" },
  ru: { name: "Russian", nativeName: "Русский", flag: "🇷🇺" },
  ar: { name: "Arabic", nativeName: "العربية", flag: "🇸🇦" },
  hi: { name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳" },
  th: { name: "Thai", nativeName: "ไทย", flag: "🇹🇭" },
  vi: { name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳" },
  id: { name: "Indonesian", nativeName: "Bahasa Indonesia", flag: "🇮🇩" },
  ms: { name: "Malay", nativeName: "Bahasa Melayu", flag: "🇲🇾" },
  tl: { name: "Filipino", nativeName: "Filipino", flag: "🇵🇭" },
  nl: { name: "Dutch", nativeName: "Nederlands", flag: "🇳🇱" },
  pl: { name: "Polish", nativeName: "Polski", flag: "🇵🇱" },
  cs: { name: "Czech", nativeName: "Čeština", flag: "🇨🇿" },
  sv: { name: "Swedish", nativeName: "Svenska", flag: "🇸🇪" },
  da: { name: "Danish", nativeName: "Dansk", flag: "🇩🇰" },
  tr: { name: "Turkish", nativeName: "Türkçe", flag: "🇹🇷" },
  uk: { name: "Ukrainian", nativeName: "Українська", flag: "🇺🇦" },
};

// Popular language pairs
const POPULAR_PAIRS = [
  ["ko", "en"], ["ko", "ja"], ["ko", "zh"], ["ko", "es"],
  ["en", "ja"], ["en", "zh"], ["en", "fr"], ["en", "de"],
];

// Domain-specific vocabulary hints
const DOMAIN_HINTS: Record<string, string> = {
  general: "",
  business: "Use formal business terminology. Preserve corporate jargon and professional tone.",
  medical: "Use precise medical terminology. Preserve drug names, diagnoses, and clinical terms in their standard form.",
  legal: "Use standard legal terminology. Preserve legal citations and terms of art.",
  technical: "Preserve technical terms, variable names, and API references. Use standard engineering vocabulary.",
};

/**
 * GET /api/interpreter — Return supported languages and pairs
 */
export async function GET() {
  return NextResponse.json({
    languages: SUPPORTED_LANGUAGES,
    popular_pairs: POPULAR_PAIRS.map(([s, t]) => ({
      source: s,
      target: t,
      label: `${SUPPORTED_LANGUAGES[s].flag} ${SUPPORTED_LANGUAGES[s].nativeName} → ${SUPPORTED_LANGUAGES[t].flag} ${SUPPORTED_LANGUAGES[t].nativeName}`,
    })),
    domains: Object.keys(DOMAIN_HINTS),
    modes: ["translate", "bidirectional"],
    voice_info: "음성 실시간 통역은 MoA 데스크톱/모바일 앱에서 Gemini 2.5 Flash Native Audio로 지원됩니다.",
  });
}

/**
 * POST /api/interpreter — Translate text
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, source_lang, target_lang, user_id, mode, domain } = body as {
      text?: string;
      source_lang?: string;
      target_lang?: string;
      user_id?: string;
      mode?: string;
      domain?: string;
    };

    if (!text?.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    if (!source_lang || !target_lang) {
      return NextResponse.json({ error: "source_lang and target_lang are required" }, { status: 400 });
    }

    if (!SUPPORTED_LANGUAGES[source_lang] || !SUPPORTED_LANGUAGES[target_lang]) {
      return NextResponse.json({ error: "Unsupported language code" }, { status: 400 });
    }

    const sourceName = SUPPORTED_LANGUAGES[source_lang].nativeName;
    const targetName = SUPPORTED_LANGUAGES[target_lang].nativeName;
    const domainHint = DOMAIN_HINTS[domain ?? "general"] ?? "";

    // Build translation prompt
    const systemPrompt = `You are a professional real-time interpreter. Translate the following text from ${sourceName} to ${targetName}. ${domainHint}

Rules:
- Preserve the original meaning, tone, and nuance exactly
- Keep proper nouns, brand names, and technical terms as-is (or transliterate if needed)
- If the text contains mixed languages, translate only the ${sourceName} parts
- Output ONLY the translated text — no explanations, no commentary
- Preserve formatting (line breaks, bullet points, etc.)`;

    // Try Gemini first (best for multilingual), then fallback
    const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    let translated: string;
    let model: string;

    if (geminiKey) {
      const result = await callGemini(geminiKey, systemPrompt, text.trim());
      translated = result.text;
      model = result.model;
    } else if (openaiKey) {
      const result = await callOpenAI(openaiKey, systemPrompt, text.trim());
      translated = result.text;
      model = result.model;
    } else if (anthropicKey) {
      const result = await callAnthropic(anthropicKey, systemPrompt, text.trim());
      translated = result.text;
      model = result.model;
    } else {
      return NextResponse.json(
        { error: "No LLM API key configured. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      original: text.trim(),
      translated,
      source_lang,
      target_lang,
      source_name: sourceName,
      target_name: targetName,
      model,
      mode: mode ?? "translate",
      domain: domain ?? "general",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Interpreter] Error:", err);
    return NextResponse.json(
      { error: "Translation failed. Please try again." },
      { status: 500 },
    );
  }
}

// ── LLM Provider Calls ──

async function callGemini(apiKey: string, systemPrompt: string, text: string): Promise<{ text: string; model: string }> {
  const model = "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!result) throw new Error("Empty Gemini response");

  return { text: result, model: `gemini/${model}` };
}

async function callOpenAI(apiKey: string, systemPrompt: string, text: string): Promise<{ text: string; model: string }> {
  const model = "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const result = data.choices?.[0]?.message?.content;
  if (!result) throw new Error("Empty OpenAI response");

  return { text: result, model: `openai/${model}` };
}

async function callAnthropic(apiKey: string, systemPrompt: string, text: string): Promise<{ text: string; model: string }> {
  const model = "claude-haiku-4-5";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json() as {
    content?: Array<{ text?: string }>;
  };

  const result = data.content?.[0]?.text;
  if (!result) throw new Error("Empty Anthropic response");

  return { text: result, model: `anthropic/${model}` };
}
