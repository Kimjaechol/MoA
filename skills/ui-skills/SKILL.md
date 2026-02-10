---
name: ui-skills
description: Comprehensive UI development toolkit for building interfaces.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🧩",
        "requires": { "bins": ["node"] },
      },
  }
---

# UI Skills

A comprehensive toolkit for building, styling, and managing user interface components across frameworks.

## When to use

- Build reusable UI components (buttons, modals, forms, tables, etc.)
- Implement complex UI patterns (infinite scroll, drag-and-drop, virtualized lists)
- Create animations and transitions
- Handle responsive design and dark mode
- Manage UI state (open/close, focus, selection)

## Component patterns

### Form components

```bash
node {baseDir}/ui-skills.js component \
  --type form \
  --fields "name:text,email:email,role:select,bio:textarea" \
  --validation zod \
  --framework react \
  --output ./src/components/UserForm.tsx
```

### Data display

```bash
node {baseDir}/ui-skills.js component \
  --type data-table \
  --columns "name,email,role,createdAt" \
  --features "sort,filter,pagination,selection" \
  --framework react \
  --output ./src/components/UsersTable.tsx
```

### Navigation

```bash
node {baseDir}/ui-skills.js component \
  --type sidebar \
  --features "collapsible,nested-items,active-state,mobile-drawer" \
  --framework react \
  --output ./src/components/Sidebar.tsx
```

## Capabilities (no API key needed)

- **Component scaffolding** — Generate boilerplate for common UI patterns
- **Animation recipes** — CSS transitions, keyframe animations, spring physics
- **Responsive patterns** — Container queries, fluid typography, adaptive layouts
- **Dark mode** — CSS custom property based theming with system preference detection
- **Accessibility** — ARIA patterns, keyboard navigation, screen reader support
- **State machines** — UI state management for complex interactions (modals, wizards, menus)

## Interaction patterns

```bash
# Generate a modal dialog with proper focus trapping
node {baseDir}/ui-skills.js pattern \
  --type modal \
  --features "focus-trap,escape-close,backdrop-click,animation" \
  --output ./src/components/Modal.tsx

# Generate infinite scroll with virtualization
node {baseDir}/ui-skills.js pattern \
  --type infinite-scroll \
  --item-height 64 \
  --output ./src/components/VirtualList.tsx

# Generate drag-and-drop sortable list
node {baseDir}/ui-skills.js pattern \
  --type sortable-list \
  --output ./src/components/SortableList.tsx
```

## CSS utilities

```bash
# Generate a utility-first CSS framework subset
node {baseDir}/ui-skills.js css \
  --type utilities \
  --include "spacing,typography,colors,flex,grid" \
  --output utilities.css

# Generate CSS reset and base styles
node {baseDir}/ui-skills.js css \
  --type reset \
  --output reset.css
```
