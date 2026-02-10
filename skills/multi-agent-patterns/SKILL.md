---
name: multi-agent-patterns
description: Orchestrator, peer-to-peer, and hierarchical multi-agent coordination patterns.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🕸️",
        "requires": { "bins": ["node"] },
      },
  }
---

# Multi-Agent Patterns

Reference implementations for common multi-agent coordination patterns: orchestrator, peer-to-peer, hierarchical, and pipeline.

## When to use

- Coordinate multiple specialized agents on a complex task
- Implement supervisor/worker patterns for parallel execution
- Build debate or consensus protocols between agents
- Design pipeline architectures where agents hand off work sequentially

## Patterns

### 1. Orchestrator (hub-and-spoke)

A central orchestrator delegates subtasks to specialist agents and synthesizes results:

```yaml
# orchestrator.yaml
orchestrator:
  model: claude-sonnet
  role: "Break down the task and delegate to specialists"
agents:
  researcher:
    model: claude-haiku
    tools: [web-search, read-file]
    role: "Gather and summarize information"
  coder:
    model: claude-sonnet
    tools: [bash, edit-file]
    role: "Write and test code"
  reviewer:
    model: claude-sonnet
    tools: [read-file]
    role: "Review code for correctness and style"
```

```bash
node {baseDir}/agents.js run --pattern orchestrator --config orchestrator.yaml \
  --task "Build a REST API for user management"
```

### 2. Peer-to-peer (debate)

Agents discuss and critique each other's outputs to reach consensus:

```bash
node {baseDir}/agents.js run --pattern debate \
  --agents "agent-a,agent-b" \
  --rounds 3 \
  --task "What is the best database for this use case?"
```

### 3. Hierarchical

Multi-level delegation: manager -> team leads -> workers:

```bash
node {baseDir}/agents.js run --pattern hierarchical \
  --config hierarchy.yaml \
  --task "Refactor the authentication module"
```

### 4. Pipeline

Sequential handoff where each agent's output feeds the next:

```yaml
# pipeline.yaml
stages:
  - name: research
    agent: researcher
    output: research-notes.md
  - name: draft
    agent: writer
    input: research-notes.md
    output: draft.md
  - name: edit
    agent: editor
    input: draft.md
    output: final.md
```

```bash
node {baseDir}/agents.js run --pattern pipeline --config pipeline.yaml
```

## Communication protocols

- **Message passing**: agents communicate via a shared message queue
- **Shared workspace**: agents read/write to a shared file directory
- **Structured handoff**: each agent produces a typed output schema consumed by the next

## Guardrails

- `--max-total-iterations` caps the total work across all agents
- `--timeout` sets a wall-clock limit for the entire run
- Each agent has independent token and tool-call budgets
