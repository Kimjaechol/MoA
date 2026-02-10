---
name: context-optimization
description: Context caching, masking, and prioritization strategies for efficient LLM usage.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🎯",
        "requires": { "bins": ["node"] },
      },
  }
---

# Context Optimization

Strategies for managing LLM context windows efficiently: caching repeated context, masking irrelevant sections, and prioritizing high-value information.

## When to use

- Reduce API costs by caching static context across calls
- Mask sensitive or irrelevant sections before sending to an LLM
- Prioritize which context blocks to include when the window is tight
- Manage multi-document context assembly for complex queries

## Strategies

### 1. Context caching

Cache static context blocks (system prompts, reference docs, tool schemas) to avoid re-sending:

```bash
node {baseDir}/optimize.js cache set \
  --key "system-prompt-v3" \
  --file system-prompt.md \
  --ttl 3600
```

```bash
# Reference cached context in a request
node {baseDir}/optimize.js build \
  --cached "system-prompt-v3" \
  --dynamic conversation.jsonl \
  --output assembled-context.json
```

### 2. Context masking

Redact or mask sections that are not relevant to the current query:

```bash
node {baseDir}/optimize.js mask \
  --input full-context.json \
  --query "What are the API rate limits?" \
  --keep-relevant \
  --output masked-context.json
```

Masking strategies:
- `keep-relevant` -- semantic similarity filtering (keep top-K blocks)
- `redact-pii` -- mask emails, phone numbers, API keys
- `section-filter` -- include/exclude by heading or tag

### 3. Priority scoring

Score context blocks by relevance and recency, then fill the window greedily:

```bash
node {baseDir}/optimize.js prioritize \
  --blocks context-blocks/ \
  --query "How do I deploy to production?" \
  --max-tokens 8000 \
  --output prioritized.json
```

Each block gets a composite score: `0.6 * relevance + 0.3 * recency + 0.1 * importance_tag`.

### 4. Sliding window with anchors

Keep critical context blocks "anchored" (always included) while sliding the rest:

```json
{
  "anchors": ["system-prompt", "user-preferences"],
  "sliding": {
    "strategy": "recency",
    "maxTokens": 4000
  }
}
```

## Metrics

```bash
node {baseDir}/optimize.js stats --context assembled-context.json
```

Reports: total tokens, cached vs dynamic ratio, estimated cost savings, and waste (low-relevance tokens included).
