---
name: figma
description: Figma design file inspection, export, and design token extraction.
homepage: https://www.figma.com/developers
metadata:
  {
    "openclaw":
      {
        "emoji": "🎨",
        "requires": { "bins": ["node"] },
        "primaryEnv": "FIGMA_ACCESS_TOKEN",
      },
  }
---

# Figma

Inspect Figma files, extract design tokens, export assets, and review component structures via the Figma REST API.

## When to use

- Extract colors, typography, and spacing tokens from a Figma file
- Export component assets (SVG, PNG) from Figma frames
- Inspect component hierarchy and auto-layout properties
- Bridge design-to-code by generating CSS/Tailwind from Figma styles
- Review design files without opening the Figma app

## Quick start (with API key)

```bash
export FIGMA_ACCESS_TOKEN="your-token-here"

# Inspect a file
node {baseDir}/figma.js inspect \
  --file-key "abc123XYZ" \
  --node-id "1:42"

# Export assets
node {baseDir}/figma.js export \
  --file-key "abc123XYZ" \
  --format svg \
  --output ./assets/

# Extract design tokens
node {baseDir}/figma.js tokens \
  --file-key "abc123XYZ" \
  --output ./tokens.json
```

## API Key Setup

1. Go to https://www.figma.com/developers → Personal Access Tokens
2. Create a new token with read access
3. Export it:

```bash
export FIGMA_ACCESS_TOKEN="your-token-here"
```

### Benefits of API Key

- Direct access to Figma file data (nodes, styles, components)
- Asset export at any resolution or format
- Design token extraction for design-to-code workflows
- Component inventory and usage analysis

## Free Fallback

Without a Figma API key, use local design file analysis:

```bash
# Parse exported Figma JSON (File → Export as .fig or use Figma plugin to export JSON)
node {baseDir}/figma.js parse-local \
  --input design-export.json \
  --output tokens.json

# Generate CSS variables from a hand-written design tokens JSON
node {baseDir}/figma.js tokens-to-css \
  --input tokens.json \
  --output variables.css
```

You can also use the open-source `figma-export` CLI or export assets manually from Figma's free tier.

## Commands

```bash
# List all pages and top-level frames
node {baseDir}/figma.js pages --file-key "abc123XYZ"

# Get component details
node {baseDir}/figma.js component --file-key "abc123XYZ" --component-name "Button"

# Generate Tailwind config from Figma styles
node {baseDir}/figma.js tailwind --file-key "abc123XYZ" --output tailwind.config.js
```
