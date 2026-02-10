---
name: ui-design-system
description: Design system creation, management, and documentation.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "📐",
        "requires": { "bins": ["node"] },
      },
  }
---

# UI Design System

Create, manage, and document design systems. Generates tokens, component libraries, and living documentation from a single source of truth.

## When to use

- Bootstrap a new design system from scratch
- Generate design tokens (colors, typography, spacing, shadows, etc.)
- Create a component library with consistent APIs
- Build living documentation / style guide
- Audit an existing codebase for design system adoption
- Migrate from hardcoded values to design tokens

## Quick start

```bash
# Initialize a design system
node {baseDir}/ui-design-system.js init \
  --name "MyDesignSystem" \
  --framework react \
  --output ./design-system/

# Generate tokens from a config
node {baseDir}/ui-design-system.js tokens \
  --input design-tokens.yaml \
  --output-css ./src/styles/tokens.css \
  --output-ts ./src/tokens.ts \
  --output-tailwind ./tailwind.config.js
```

## Design tokens

### Token generation

```bash
# Generate a full color palette from brand colors
node {baseDir}/ui-design-system.js colors \
  --primary "#2563EB" \
  --secondary "#7C3AED" \
  --output tokens/colors.json

# Generate a type scale
node {baseDir}/ui-design-system.js typography \
  --base-size 16 \
  --scale "1.25" \
  --font-family "Inter, system-ui, sans-serif" \
  --output tokens/typography.json

# Generate spacing scale
node {baseDir}/ui-design-system.js spacing \
  --base 4 \
  --steps 12 \
  --output tokens/spacing.json
```

### Multi-format export

```bash
# Export tokens to multiple formats at once
node {baseDir}/ui-design-system.js export \
  --input tokens/ \
  --formats "css,scss,ts,tailwind,json" \
  --output ./dist/tokens/
```

Supported formats:
- CSS custom properties
- SCSS variables and maps
- TypeScript constants
- Tailwind config
- JSON (Style Dictionary compatible)
- Figma Tokens (JSON)

## Component library

```bash
# Scaffold a component with all variants
node {baseDir}/ui-design-system.js component \
  --name Button \
  --variants "primary,secondary,ghost,danger" \
  --sizes "sm,md,lg" \
  --states "default,hover,active,disabled,loading" \
  --framework react \
  --output ./src/components/Button/

# Generate documentation for a component
node {baseDir}/ui-design-system.js docs \
  --input ./src/components/Button/ \
  --output ./docs/components/Button.mdx
```

## Adoption audit

```bash
# Check how well the codebase uses design tokens vs hardcoded values
node {baseDir}/ui-design-system.js audit \
  --input ./src/ \
  --tokens ./tokens/ \
  --output adoption-report.md
```

Detects:
- Hardcoded color values (hex, rgb, hsl)
- Hardcoded spacing/sizing values
- Non-standard font sizes
- Inconsistent border radii
- Custom shadows instead of token values

## Capabilities (no API key needed)

Everything runs locally. No external services required.

- Design token generation (color palettes, type scales, spacing)
- Multi-format token export (CSS, SCSS, TS, Tailwind, JSON)
- Component scaffolding with variants, sizes, and states
- Component documentation generation
- Design system adoption auditing
- Theme generation (light/dark mode)
