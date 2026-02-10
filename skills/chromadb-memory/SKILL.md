---
name: chromadb-memory
description: Long-term memory using ChromaDB with local Ollama embeddings. No API key required.
homepage: https://docs.trychroma.com
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "requires": { "bins": ["chroma", "ollama"] },
        "install":
          [
            {
              "id": "pip-chromadb",
              "kind": "pip",
              "package": "chromadb",
              "bins": ["chroma"],
              "label": "Install ChromaDB (pip)",
            },
            {
              "id": "brew-ollama",
              "kind": "brew",
              "formula": "ollama",
              "bins": ["ollama"],
              "label": "Install Ollama (brew)",
            },
          ],
      },
  }
---

# ChromaDB Memory

Persistent vector memory for agents using ChromaDB and local Ollama embeddings. Everything runs offline -- no API keys, no cloud services.

## When to use

- Store and retrieve long-term memories, notes, or context across sessions
- Semantic search over past conversations or documents
- Build a personal knowledge base that persists between agent runs

## Quick start

1. Start Ollama and pull an embedding model:

```bash
ollama serve &
ollama pull nomic-embed-text
```

2. Start ChromaDB server:

```bash
chroma run --path ~/.openclaw/chromadb-data --port 8000
```

3. Store a memory:

```python
import chromadb

client = chromadb.HttpClient(host="localhost", port=8000)
collection = client.get_or_create_collection("agent-memory")
collection.add(
    documents=["User prefers dark mode and vim keybindings"],
    ids=["mem-001"],
    metadatas=[{"source": "preference", "timestamp": "2025-01-15"}]
)
```

4. Query memories:

```python
results = collection.query(query_texts=["What editor settings does the user like?"], n_results=5)
print(results["documents"])
```

## Embedding model

Default: `nomic-embed-text` (274M params, runs on CPU). Alternatives:

- `mxbai-embed-large` -- higher quality, slower
- `all-minilm` -- smaller/faster, good for constrained hardware

Configure the embedding function:

```python
from chromadb.utils.embedding_functions import OllamaEmbeddingFunction

ef = OllamaEmbeddingFunction(model_name="nomic-embed-text", url="http://localhost:11434")
collection = client.get_or_create_collection("agent-memory", embedding_function=ef)
```

## Persistence

Data lives at `~/.openclaw/chromadb-data` by default. Back up this directory to preserve memories across reinstalls.
