import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/autocode/test
 *
 * Validates generated code for errors.
 * In production, this would:
 *   1. Compile/lint the code
 *   2. Run it in a sandbox
 *   3. Capture screenshots via Vision Layer 3
 *   4. Parse console errors + service errors
 *
 * Body: { code, framework, goal, visionEnabled }
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, framework = "nextjs", visionEnabled = true } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    // Static analysis: check for common issues
    const staticErrors = staticAnalysis(code, framework);
    errors.push(...staticErrors);

    // Syntax validation
    const syntaxErrors = syntaxCheck(code, framework);
    errors.push(...syntaxErrors);

    // Framework-specific checks
    const frameworkWarnings = frameworkCheck(code, framework);
    warnings.push(...frameworkWarnings);

    // Vision-based checks (placeholder for real Vision Layer 3 integration)
    if (visionEnabled && errors.length === 0) {
      const visionResults = await visionCheck(code);
      warnings.push(...visionResults.warnings);
      errors.push(...visionResults.errors);
    }

    return NextResponse.json({
      errors,
      warnings,
      passed: errors.length === 0,
      checks: {
        static: staticErrors.length === 0,
        syntax: syntaxErrors.length === 0,
        framework: frameworkWarnings.length === 0,
        vision: visionEnabled,
      },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function staticAnalysis(code: string, framework: string): string[] {
  const errors: string[] = [];

  // Check for undefined variables (simple heuristic)
  if (code.includes("undefined") && code.includes("= undefined;")) {
    // Not an error, skip
  }

  // Check for missing imports
  if (framework === "nextjs" || framework === "react") {
    if (code.includes("useState") && !code.includes("import") && !code.includes("require")) {
      errors.push("Missing import: useState is used but not imported from React");
    }
    if (code.includes("useEffect") && !code.includes("import") && !code.includes("require")) {
      errors.push("Missing import: useEffect is used but not imported from React");
    }
  }

  // Check for common mistakes
  if (code.includes("console.err(")) {
    errors.push("Typo: console.err should be console.error");
  }
  if (code.includes("documet.")) {
    errors.push("Typo: documet should be document");
  }

  // Check for unclosed brackets (simple check)
  const openBraces = (code.match(/{/g) ?? []).length;
  const closeBraces = (code.match(/}/g) ?? []).length;
  if (openBraces !== closeBraces) {
    errors.push(`Bracket mismatch: ${openBraces} opening braces vs ${closeBraces} closing braces`);
  }

  const openParens = (code.match(/\(/g) ?? []).length;
  const closeParens = (code.match(/\)/g) ?? []).length;
  if (openParens !== closeParens) {
    errors.push(`Parenthesis mismatch: ${openParens} opening vs ${closeParens} closing`);
  }

  return errors;
}

function syntaxCheck(code: string, framework: string): string[] {
  const errors: string[] = [];

  // Check for obvious syntax errors
  if (framework === "python") {
    // Python indentation check (simplified)
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("\t") && lines.some((l) => l.match(/^ /))) {
        errors.push(`Line ${i + 1}: Mixed tabs and spaces in indentation`);
        break;
      }
    }
  } else {
    // JS/TS checks
    if (code.includes("export default") && code.split("export default").length > 2) {
      errors.push("Multiple default exports found");
    }
  }

  return errors;
}

function frameworkCheck(code: string, framework: string): string[] {
  const warnings: string[] = [];

  if (framework === "nextjs") {
    if (code.includes("document.") && !code.includes("useEffect")) {
      warnings.push("Next.js: document access should be inside useEffect for SSR compatibility");
    }
    if (code.includes("window.") && !code.includes("typeof window")) {
      warnings.push("Next.js: window access should check typeof window for SSR");
    }
  }

  if (framework === "react" || framework === "nextjs") {
    if (code.includes("dangerouslySetInnerHTML")) {
      warnings.push("Security: dangerouslySetInnerHTML detected — ensure content is sanitized");
    }
    if (code.match(/style=["'][^"']*["']/)) {
      warnings.push("React: style should be an object, not a string");
    }
  }

  return warnings;
}

async function visionCheck(_code: string): Promise<{ errors: string[]; warnings: string[] }> {
  // In production, this would:
  // 1. Render the code in a sandboxed iframe
  // 2. Capture a screenshot using Vision Layer 3
  // 3. Analyze the screenshot for visual issues
  // 4. Check browser console for runtime errors
  // 5. Validate against service-specific error patterns (Railway, Vercel, Supabase)

  return {
    errors: [],
    warnings: ["Vision check: Sandbox preview not available in current environment"],
  };
}
