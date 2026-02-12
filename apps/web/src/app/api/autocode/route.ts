import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/autocode
 *
 * AI-powered code generation with Vision-based error detection.
 * Receives a coding goal and returns generated/fixed code.
 *
 * Body: { goal, framework, model, iteration, previousCode, previousErrors, visionEnabled }
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      goal,
      framework = "nextjs",
      model = "auto",
      iteration = 1,
      previousCode = "",
      previousErrors = [],
      visionEnabled = true,
    } = body;

    if (!goal || typeof goal !== "string") {
      return NextResponse.json({ error: "Coding goal is required" }, { status: 400 });
    }

    const systemPrompt = buildCodeSystemPrompt(framework, visionEnabled);
    const userPrompt = iteration === 1
      ? buildInitialPrompt(goal, framework)
      : buildFixPrompt(goal, framework, previousCode, previousErrors);

    const result = await callCodeLlm(systemPrompt, userPrompt, model);

    if (result) {
      const code = extractCodeBlock(result.text);
      return NextResponse.json({
        code,
        model: result.model,
        iteration,
        raw: result.text,
      });
    }

    // Fallback: generate a template
    const template = generateTemplate(goal, framework);
    return NextResponse.json({
      code: template,
      model: "template/fallback",
      iteration,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function buildCodeSystemPrompt(framework: string, visionEnabled: boolean): string {
  return `You are an expert ${framework} developer and autonomous coding agent.

Your task:
1. Generate complete, production-ready code
2. The code must be self-contained and immediately runnable
3. Include all necessary imports and dependencies
4. Follow best practices for ${framework}
5. Handle edge cases and errors gracefully
${visionEnabled ? "6. Consider visual output — the code's UI will be screenshotted and validated by Vision AI" : ""}

When fixing errors:
- Analyze the error messages carefully
- Identify the root cause
- Fix ALL reported errors, not just the first one
- Ensure fixes don't introduce new issues
- Explain what you changed and why

Output the complete code in a single markdown code block.
After the code block, briefly explain what the code does and any changes made.`;
}

function buildInitialPrompt(goal: string, framework: string): string {
  return `Create a complete ${framework} application with the following requirements:

${goal}

Requirements:
- Complete, runnable code in a single file
- All UI components styled (use CSS-in-JS or inline styles)
- Proper error handling
- Responsive design
- TypeScript if applicable

Return the complete code in a markdown code block.`;
}

function buildFixPrompt(goal: string, framework: string, previousCode: string, errors: string[]): string {
  const errorList = errors.map((e, i) => `${i + 1}. ${e}`).join("\n");
  const codePreview = previousCode.length > 6000 ? previousCode.slice(0, 6000) + "\n// ... truncated" : previousCode;

  return `The following ${framework} code has errors that need to be fixed.

Original goal: ${goal}

Current code:
\`\`\`
${codePreview}
\`\`\`

Errors found:
${errorList}

Please fix ALL these errors and return the complete corrected code in a markdown code block.
Explain what you changed.`;
}

interface LlmResult {
  text: string;
  model: string;
}

async function callCodeLlm(systemPrompt: string, userPrompt: string, preferredModel: string): Promise<LlmResult | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Route based on preferred model
  if ((preferredModel === "claude-opus-4-6" || preferredModel === "auto") && anthropicKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: preferredModel === "auto" ? "claude-sonnet-4-5-20250929" : "claude-opus-4-6",
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.content?.[0]?.text;
        if (text) return { text, model: `anthropic/${preferredModel === "auto" ? "claude-sonnet-4-5" : "claude-opus-4-6"}` };
      }
    } catch { /* fall through */ }
  }

  if ((preferredModel === "gpt-5" || preferredModel === "auto") && openaiKey) {
    try {
      const model = preferredModel === "gpt-5" ? "gpt-5" : "gpt-4o";
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 8192,
          temperature: 0.3,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return { text, model: `openai/${model}` };
      }
    } catch { /* fall through */ }
  }

  if ((preferredModel === "gemini-2.5-flash" || preferredModel === "auto") && geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
            generationConfig: { maxOutputTokens: 8192, temperature: 0.3 },
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { text, model: "gemini/gemini-2.5-flash" };
      }
    } catch { /* fall through */ }
  }

  if (preferredModel === "deepseek-chat") {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      try {
        const res = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: 8192,
            temperature: 0.3,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const text = data.choices?.[0]?.message?.content;
          if (text) return { text, model: "deepseek/deepseek-chat" };
        }
      } catch { /* fall through */ }
    }
  }

  return null;
}

function extractCodeBlock(result: string): string {
  // Extract code from markdown code blocks
  const codeBlockMatch = result.match(/```(?:tsx?|jsx?|python|py|javascript|typescript|html|css|vue)?\n([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Try any code block
  const anyBlock = result.match(/```\n?([\s\S]*?)```/);
  if (anyBlock) return anyBlock[1].trim();

  // Return raw if no code block found
  return result;
}

function generateTemplate(goal: string, framework: string): string {
  const templates: Record<string, string> = {
    nextjs: `"use client";

import { useState } from "react";

/**
 * Auto-generated template for: ${goal}
 *
 * Note: AI model not available. This is a basic template.
 * Configure your API key in MyPage to enable AI code generation.
 */
export default function App() {
  const [data, setData] = useState("");

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>MoA Auto-Code Template</h1>
      <p>Goal: ${goal}</p>
      <p>Framework: Next.js (${framework})</p>
      <p style={{ color: "#666", marginTop: "1rem" }}>
        AI 코드 생성을 위해 마이페이지에서 API 키를 설정해주세요.
      </p>
    </div>
  );
}`,
    react: `import React, { useState } from "react";

/**
 * Auto-generated template for: ${goal}
 */
export default function App() {
  return (
    <div style={{ padding: "2rem" }}>
      <h1>MoA Auto-Code Template</h1>
      <p>Goal: ${goal}</p>
    </div>
  );
}`,
    python: `"""
Auto-generated template for: ${goal}
Framework: Python
"""

def main():
    print("MoA Auto-Code Template")
    print(f"Goal: ${goal}")
    # TODO: Implement with AI

if __name__ == "__main__":
    main()`,
    vue: `<template>
  <div style="padding: 2rem">
    <h1>MoA Auto-Code Template</h1>
    <p>Goal: ${goal}</p>
  </div>
</template>

<script setup lang="ts">
// Auto-generated template
</script>`,
    node: `/**
 * Auto-generated template for: ${goal}
 * Framework: Node.js
 */

const http = require("http");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<h1>MoA Auto-Code Template</h1>");
});

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});`,
  };

  return templates[framework] ?? templates.nextjs;
}
