---
name: context-compression
description: Token compression and pruning for small language model optimization.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🗜️",
        "requires": { "bins": ["node"] },
      },
  }
---

# Context Compression

Token compression toolkit for optimizing context windows, especially useful with small language models (SLMs) that have limited context length.

## When to use

- Fit more information into a constrained context window (4K-8K tokens)
- Reduce token costs for API-based models by compressing verbose context
- Summarize and prune conversation history while preserving key information
- Compress tool outputs, logs, or documents before injecting as context

## Strategies

### 1. Extractive compression

Keep only the most relevant sentences based on query similarity:

```bash
node {baseDir}/compress.js extract \
  --input context.txt \
  --query "What are the project deadlines?" \
  --target-tokens 1000
```

### 2. Abstractive summarization

Summarize blocks of text into compact representations:

```bash
node {baseDir}/compress.js summarize \
  --input conversation-log.txt \
  --max-tokens 500
```

### 3. Token pruning

Remove low-information tokens (filler words, redundant whitespace, boilerplate):

```bash
node {baseDir}/compress.js prune \
  --input verbose-output.txt \
  --ratio 0.5
```

### 4. Hierarchical compression

Compress in layers: first summarize old turns, then extract from recent turns:

```json
{
  "layers": [
    { "age": ">10 turns", "strategy": "summarize", "targetRatio": 0.2 },
    { "age": ">5 turns",  "strategy": "extract",   "targetRatio": 0.5 },
    { "age": "recent",    "strategy": "none" }
  ]
}
```

```bash
node {baseDir}/compress.js hierarchical \
  --config compression-config.json \
  --input session.jsonl
```

## Measuring compression quality

```bash
node {baseDir}/compress.js eval \
  --original context.txt \
  --compressed compressed.txt \
  --query "key questions to test retention"
```

Reports: compression ratio, token count, and semantic similarity score between original and compressed content.

## Tips

- For SLMs (Phi, Gemma, Llama-3B), aim for 60-70% compression on old context
- Always keep the most recent 2-3 turns uncompressed for coherence
- Combine with memory-systems skill for persistent storage of compressed summaries
