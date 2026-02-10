---
name: memory-systems
description: Short-term, long-term, and graph-based memory architecture for agents.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🗄️",
        "requires": { "bins": ["node"] },
      },
  }
---

# Memory Systems

A layered memory architecture for agents: short-term (session buffer), long-term (persistent vector store), and graph-based (entity relationships).

## When to use

- Build agents that remember context across sessions
- Track entity relationships (people, projects, preferences) in a knowledge graph
- Implement working memory that summarizes and compresses over time
- Combine multiple retrieval strategies for richer context injection

## Architecture

```
                 +-------------------+
  Conversation ->| Short-term Memory |  (sliding window, last N turns)
                 +--------+----------+
                          |
                   summarize / promote
                          |
                 +--------v----------+
                 | Long-term Memory  |  (vector store, semantic search)
                 +--------+----------+
                          |
                   entity extraction
                          |
                 +--------v----------+
                 | Graph Memory      |  (nodes = entities, edges = relations)
                 +-------------------+
```

## Short-term memory

Keeps the last N conversation turns in a sliding window. Configurable compression:

```json
{
  "shortTerm": {
    "maxTurns": 20,
    "compressAfter": 15,
    "strategy": "summarize"
  }
}
```

When the window fills, older turns are summarized into a single context block and promoted to long-term memory.

## Long-term memory

Persistent vector store (ChromaDB, SQLite-vec, or file-based). Stores:

- Conversation summaries
- User preferences and facts
- Task outcomes and lessons learned

Retrieval: top-K semantic search on the current query, injected as context.

```bash
node {baseDir}/memory.js store --collection agent-ltm \
  --text "User prefers metric units" --tags "preference"

node {baseDir}/memory.js query --collection agent-ltm \
  --query "What units does the user prefer?" --top-k 5
```

## Graph memory

Entity-relationship graph stored as JSON adjacency lists or in a local graph DB.

```bash
node {baseDir}/memory.js graph add-entity --name "Alice" --type person
node {baseDir}/memory.js graph add-relation --from "Alice" --to "ProjectX" --relation "works-on"
node {baseDir}/memory.js graph query --entity "Alice" --depth 2
```

Use graph memory to answer relationship questions ("Who works on ProjectX?") that vector search alone handles poorly.

## Configuration

All memory data lives under `~/.openclaw/memory-systems/` by default. Override via:

```bash
node {baseDir}/memory.js init --data-dir /path/to/memory
```
