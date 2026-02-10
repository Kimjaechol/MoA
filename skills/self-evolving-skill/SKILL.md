---
name: self-evolving-skill
description: Metacognitive self-learning with predictive coding and skill adaptation.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🧬",
        "requires": { "bins": ["node"] },
      },
  }
---

# Self-Evolving Skill

A metacognitive framework that enables agents to learn from past interactions, predict user needs, and adapt their behavior over time.

## When to use

- Build agents that improve their responses based on feedback signals
- Implement predictive coding: anticipate what the user will ask next
- Automatically refine prompts and tool selection based on success/failure patterns
- Create self-improving workflows that optimize over repeated runs

## Architecture

```
Interaction -> Outcome Tracker -> Pattern Analyzer -> Strategy Updater -> Next Interaction
                                         |
                                  Predictive Model
                                  (what will user ask next?)
```

## Quick start

1. Initialize the learning store:

```bash
node {baseDir}/evolve.js init --data-dir ~/.openclaw/self-evolving/
```

2. Record an interaction outcome:

```bash
node {baseDir}/evolve.js record \
  --task "summarize-email" \
  --strategy "extractive-summary" \
  --outcome success \
  --feedback "User accepted without edits"
```

3. Query for the best strategy:

```bash
node {baseDir}/evolve.js recommend --task "summarize-email"
# Output: extractive-summary (85% success rate, 20 samples)
```

## Predictive coding

The system builds a transition model from interaction sequences:

```bash
node {baseDir}/evolve.js predict --last-task "check-calendar" --top-k 3
# Output:
# 1. send-email (42% probability)
# 2. create-task (28% probability)
# 3. check-weather (15% probability)
```

Use predictions to pre-fetch data or suggest next actions proactively.

## Prompt evolution

Track which prompt variants perform best for each task type:

```bash
node {baseDir}/evolve.js prompts list --task "code-review"
node {baseDir}/evolve.js prompts test --task "code-review" --variant-a "v3" --variant-b "v4" --samples 50
```

The system runs A/B comparisons and promotes the winning variant automatically.

## Data

All learning data lives at `~/.openclaw/self-evolving/`:

- `outcomes.jsonl` -- raw interaction records
- `strategies.json` -- learned strategy rankings per task type
- `transitions.json` -- task sequence transition probabilities
- `prompts/` -- prompt variant store with performance metrics
