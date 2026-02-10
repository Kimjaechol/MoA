---
name: ux-audit
description: Audit user experience flows for usability, clarity, and friction points.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🧭",
        "requires": { "bins": ["node"] },
      },
  }
---

# UX Audit

Analyze user experience flows, information architecture, and interaction patterns. Identifies friction points, cognitive load issues, and improvement opportunities.

## When to use

- Review a user flow (signup, checkout, onboarding) for friction points
- Analyze information architecture and navigation structure
- Evaluate form design and input validation UX
- Assess error handling and empty state experiences
- Review copy/microcopy for clarity and helpfulness
- Compare interaction patterns against established UX heuristics

## Audits

### Flow analysis

```bash
# Analyze a user flow from route/page files
node {baseDir}/ux-audit.js flow \
  --input ./src/pages/ \
  --flow "signup" \
  --output flow-report.md
```

Evaluates:
- Number of steps and cognitive load per step
- Required vs optional fields per step
- Progress indication and back-navigation
- Error recovery paths
- Success state and next actions
- Drop-off risk points

### Heuristic evaluation

```bash
# Run Nielsen's 10 usability heuristics evaluation
node {baseDir}/ux-audit.js heuristics \
  --input ./src/pages/Dashboard.tsx \
  --output heuristics-report.md
```

Checks against:
1. Visibility of system status
2. Match between system and real world
3. User control and freedom
4. Consistency and standards
5. Error prevention
6. Recognition rather than recall
7. Flexibility and efficiency of use
8. Aesthetic and minimalist design
9. Help users recognize, diagnose, and recover from errors
10. Help and documentation

### Form UX review

```bash
node {baseDir}/ux-audit.js form \
  --input ./src/components/CheckoutForm.tsx \
  --output form-review.md
```

Checks for:
- Input type appropriateness (email, tel, number)
- Inline validation timing (on blur, not on keystroke)
- Error message proximity and clarity
- Required field indication
- Smart defaults and autofill support
- Mobile keyboard optimization (inputmode)

### Copy review

```bash
node {baseDir}/ux-audit.js copy \
  --input ./src/ \
  --output copy-review.md
```

Checks for:
- Button label clarity (avoid "Click here", "Submit")
- Error message helpfulness (what went wrong + how to fix)
- Empty state guidance (what to do next)
- Loading state communication
- Confirmation dialog clarity
- Consistent terminology

## Capabilities (no API key needed)

All audits run locally via code analysis and pattern matching. Uses Ollama vision models (if available) for screenshot-based UX analysis.

- Route/page structure analysis
- Component interaction pattern detection
- Copy/microcopy extraction and review
- Form input analysis
- Error handling pattern detection
- Markdown report generation with actionable recommendations
