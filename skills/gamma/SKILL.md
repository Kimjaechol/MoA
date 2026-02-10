---
name: gamma
description: AI-powered presentation and document generation.
homepage: https://gamma.app
metadata:
  {
    "openclaw":
      {
        "emoji": "🎞️",
        "requires": { "bins": ["node"] },
        "primaryEnv": "GAMMA_API_KEY",
      },
  }
---

# Gamma

Generate polished presentations, documents, and web pages using Gamma's AI engine.

## When to use

- Create slide decks from a topic outline or raw notes
- Generate one-pagers, reports, or documents with professional formatting
- Convert long-form text into visual presentations
- Produce shareable web-based documents quickly

## Quick start (with API key)

```bash
export GAMMA_API_KEY="your-key-here"

node {baseDir}/gamma.js create \
  --type presentation \
  --topic "Q4 Product Roadmap" \
  --slides 10 \
  --style professional \
  --output ~/Documents/roadmap.gamma
```

Open the result at https://gamma.app or export to PDF/PPTX.

## API Key Setup

1. Sign up at https://gamma.app
2. Generate an API key from your account settings
3. Export it:

```bash
export GAMMA_API_KEY="your-key-here"
```

## Free Fallback

Without an API key, generate HTML slide decks locally using reveal.js:

```bash
node {baseDir}/gamma.js local \
  --topic "Q4 Product Roadmap" \
  --slides 10 \
  --output ~/Documents/roadmap.html
```

This generates a self-contained HTML file using reveal.js. Open it in any browser. Features:

- Keyboard navigation (arrow keys, space)
- Speaker notes (press `S`)
- PDF export (append `?print-pdf` to URL, then print)

## Templates

```bash
# List available templates
node {baseDir}/gamma.js templates

# Use a specific template
node {baseDir}/gamma.js create --template startup-pitch --topic "Our Startup"
```

## From markdown

Convert an existing markdown file into slides (one slide per `## heading`):

```bash
node {baseDir}/gamma.js from-markdown \
  --input notes.md \
  --output presentation.html
```
