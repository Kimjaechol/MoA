---
name: ui-audit
description: Audit UI code for accessibility, performance, and best practices.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🔍",
        "requires": { "bins": ["node"] },
      },
  }
---

# UI Audit

Audit UI code for accessibility (a11y), performance, consistency, and best practices. Generates actionable reports with fix suggestions.

## When to use

- Audit a component or page for WCAG 2.1 accessibility compliance
- Check color contrast ratios across a color palette
- Identify performance bottlenecks in component rendering
- Review component API consistency across a design system
- Detect common UI anti-patterns (z-index wars, !important abuse, etc.)

## Audits

### Accessibility audit

```bash
# Audit a component file for a11y issues
node {baseDir}/ui-audit.js a11y \
  --input ./src/components/LoginForm.tsx \
  --level AA \
  --output audit-report.md

# Audit all components in a directory
node {baseDir}/ui-audit.js a11y \
  --input ./src/components/ \
  --level AA \
  --format json \
  --output audit-results.json
```

Checks for:
- Missing alt text on images
- Missing form labels and ARIA attributes
- Insufficient color contrast (computed from CSS)
- Missing keyboard navigation support
- Incorrect heading hierarchy
- Missing landmark regions
- Focus management issues

### Performance audit

```bash
node {baseDir}/ui-audit.js perf \
  --input ./src/components/ \
  --output perf-report.md
```

Checks for:
- Unnecessary re-renders (missing memoization)
- Large inline objects/arrays in JSX props
- Missing `key` props in lists
- Synchronous heavy operations in render
- Unoptimized images (missing lazy loading, no size hints)
- Bundle size impact estimates

### Consistency audit

```bash
node {baseDir}/ui-audit.js consistency \
  --input ./src/components/ \
  --output consistency-report.md
```

Checks for:
- Inconsistent prop naming patterns
- Hardcoded colors/spacing instead of design tokens
- Mixed styling approaches (inline, CSS modules, styled-components)
- Inconsistent component API shapes
- Duplicate component patterns

## Capabilities (no API key needed)

All audits run locally via static analysis (AST parsing + pattern matching). No external API required.

- TypeScript/JSX/TSX AST analysis
- CSS/SCSS static analysis
- WCAG 2.1 AA/AAA rule checking
- Color contrast computation (APCA and WCAG 2.1)
- Component API shape analysis
- Markdown and JSON report generation
