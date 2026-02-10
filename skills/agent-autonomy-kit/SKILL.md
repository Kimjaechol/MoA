---
name: agent-autonomy-kit
description: Autonomous continuous task execution with goal decomposition and self-correction.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🤖",
        "requires": { "bins": ["node"] },
      },
  }
---

# Agent Autonomy Kit

Framework for autonomous, continuous task execution. Decomposes high-level goals into subtasks, executes them sequentially or in parallel, and self-corrects on failure.

## When to use

- Run multi-step tasks that require planning, execution, and verification loops
- Automate workflows that need retry logic and adaptive replanning
- Build agents that persist across sessions and resume interrupted work
- Orchestrate long-running background tasks with checkpointing

## Architecture

```
Goal -> Planner -> Task Queue -> Executor -> Verifier -> Done / Replan
                       ^                         |
                       +---- Replan on failure ---+
```

Key components:

- **Planner**: Breaks a goal into ordered subtasks with dependencies
- **Task Queue**: Persistent queue with priority, status tracking, and checkpoints
- **Executor**: Runs each subtask, captures output, and handles timeouts
- **Verifier**: Checks output against success criteria; triggers replan on failure

## Quick start

```bash
node {baseDir}/autonomy.js run --goal "Research competitor pricing and produce a summary CSV" \
  --max-iterations 20 \
  --checkpoint-dir ~/.openclaw/autonomy/checkpoints
```

### Define a task plan (YAML)

```yaml
goal: "Audit npm dependencies for security issues"
tasks:
  - id: audit
    action: "npm audit --json > /tmp/audit.json"
    success: "exit code 0 or audit report generated"
  - id: parse
    depends: [audit]
    action: "Extract high/critical vulnerabilities from /tmp/audit.json"
  - id: report
    depends: [parse]
    action: "Generate markdown summary of findings"
max_retries: 3
timeout_per_task: 120s
```

```bash
node {baseDir}/autonomy.js run --plan plan.yaml
```

## Checkpointing

State is saved to `~/.openclaw/autonomy/checkpoints/` after each subtask. Resume interrupted runs:

```bash
node {baseDir}/autonomy.js resume --checkpoint-dir ~/.openclaw/autonomy/checkpoints
```

## Safety guardrails

- `--max-iterations` caps total subtask executions (default: 50)
- `--dry-run` prints the plan without executing
- `--require-approval` pauses before destructive actions (file deletion, network writes)
- All actions are logged to `~/.openclaw/autonomy/logs/`
