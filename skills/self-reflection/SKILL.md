---
name: self-reflection
description: Systematic self-reflection and continuous self-improvement for agents.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🪞",
        "requires": { "bins": ["node"] },
      },
  }
---

# Self-Reflection

A structured framework for agent self-reflection: analyze past performance, identify failure modes, and generate improvement plans.

## When to use

- Review agent performance after a session or batch of tasks
- Identify recurring failure patterns and their root causes
- Generate actionable improvement plans from reflection data
- Implement a continuous improvement loop (act -> reflect -> adapt)

## Quick start

### Record a session for reflection

```bash
node {baseDir}/reflect.js record \
  --session-log ~/.openclaw/agents/default/sessions/latest.jsonl \
  --output ~/.openclaw/reflections/session-001.json
```

### Run reflection analysis

```bash
node {baseDir}/reflect.js analyze --input ~/.openclaw/reflections/session-001.json
```

Sample output:

```
Session Summary:
  Tasks attempted: 12
  Succeeded: 9 (75%)
  Failed: 3

Failure Analysis:
  1. Tool misuse (2 cases): Used web-search when file-read was sufficient
     -> Improvement: Check local files before searching the web
  2. Incomplete output (1 case): Stopped before finishing the summary
     -> Improvement: Add verification step after generation

Strengths:
  - Code generation accuracy: 100% (4/4 tasks)
  - Response latency: consistently under 5s

Improvement Plan:
  - Add "check local first" rule to tool selection
  - Implement output completeness check
```

## Reflection types

### Post-task reflection

Immediate reflection after each task:

```bash
node {baseDir}/reflect.js post-task \
  --task-id "task-007" \
  --outcome "partial success" \
  --notes "Generated code was correct but missed edge case"
```

### Periodic review

Aggregate reflection over a time window:

```bash
node {baseDir}/reflect.js review \
  --since "7 days ago" \
  --data-dir ~/.openclaw/reflections/
```

### Comparative reflection

Compare performance across two periods or configurations:

```bash
node {baseDir}/reflect.js compare \
  --baseline ~/.openclaw/reflections/week-01/ \
  --current ~/.openclaw/reflections/week-02/
```

## Improvement tracking

Track whether improvement plans actually improve outcomes:

```bash
node {baseDir}/reflect.js track \
  --plan improvement-plan-001.json \
  --data-dir ~/.openclaw/reflections/
```

Reports: which improvements were applied, their effect on success rate, and remaining gaps.

## Data

Reflection data lives at `~/.openclaw/reflections/` by default.
