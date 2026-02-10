---
name: frontend-design
description: Frontend design implementation from mockups, wireframes, and design specs.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🖼️",
        "requires": { "bins": ["node"] },
      },
  }
---

# Frontend Design

Translate design mockups, wireframes, and visual specs into production-ready frontend code (HTML/CSS/React/Vue/Svelte).

## When to use

- Convert a screenshot or wireframe into responsive HTML/CSS
- Implement a Figma/Sketch design as React/Vue/Svelte components
- Generate pixel-perfect layouts from design specifications
- Create responsive grid systems and component layouts
- Build landing pages, dashboards, or form layouts from visual references

## Approach

1. **Analyze the design** — Identify layout structure, spacing, typography, colors, and interactive elements
2. **Choose the stack** — Select the appropriate framework (React, Vue, Svelte, plain HTML/CSS) based on the project
3. **Build mobile-first** — Start with the smallest breakpoint and progressively enhance
4. **Use semantic HTML** — Proper heading hierarchy, landmarks, form labels
5. **Apply design tokens** — Use CSS custom properties or Tailwind for consistent styling

## Quick start

```bash
# Analyze a screenshot and generate HTML/CSS
node {baseDir}/frontend-design.js from-image \
  --input mockup.png \
  --framework react \
  --output ./src/components/

# Generate responsive layout from a spec
node {baseDir}/frontend-design.js layout \
  --columns 12 \
  --breakpoints "sm:640,md:768,lg:1024,xl:1280" \
  --output layout.css

# Convert design tokens JSON to CSS custom properties
node {baseDir}/frontend-design.js tokens \
  --input tokens.json \
  --output variables.css
```

## Capabilities (no API key needed)

- Screenshot/image analysis for layout extraction (uses local vision models via Ollama if available)
- HTML/CSS/JSX code generation from descriptions
- Responsive breakpoint scaffolding
- CSS Grid and Flexbox layout generation
- Component template scaffolding (React, Vue, Svelte)
- Tailwind class generation from design specs
- Accessibility markup (ARIA, semantic HTML)

## Best practices applied

- Mobile-first responsive design
- CSS custom properties for theming
- BEM or utility-first class naming
- Accessible color contrast (WCAG AA minimum)
- Proper focus management and keyboard navigation
- Performance-conscious asset loading (lazy images, font-display swap)
