---
name: perplexity
description: Web-grounded search and research using Perplexity AI.
homepage: https://docs.perplexity.ai
metadata:
  {
    "openclaw":
      {
        "emoji": "🔍",
        "requires": { "bins": ["curl"] },
        "primaryEnv": "PERPLEXITY_API_KEY",
      },
  }
---

# Perplexity

Web-grounded search and research using Perplexity AI's API. Returns answers with cited sources.

## When to use

- Research questions that require up-to-date web information
- Get answers with source citations for fact-checking
- Perform deep research on topics that need multiple web sources
- Replace manual web browsing with structured, sourced answers

## Quick start (with API key)

```bash
export PERPLEXITY_API_KEY="pplx-..."

curl -s https://api.perplexity.ai/chat/completions \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sonar",
    "messages": [
      {"role": "user", "content": "What are the latest developments in local LLM inference?"}
    ]
  }' | jq '.choices[0].message.content'
```

## API Key Setup

1. Sign up at https://perplexity.ai
2. Go to https://www.perplexity.ai/settings/api and generate a key
3. Export it:

```bash
export PERPLEXITY_API_KEY="pplx-..."
```

## Models

| Model          | Best for                         |
|----------------|----------------------------------|
| sonar          | Fast, web-grounded answers       |
| sonar-pro      | Deeper research, more sources    |
| sonar-deep-research | Complex multi-step research |

## Free Fallback

Without an API key, combine Brave Search API (or web scraping) with local summarization:

```bash
# Option 1: Brave Search (free tier: 2000 queries/month)
curl -s "https://api.search.brave.com/res/v1/web/search?q=local+LLM+inference" \
  -H "X-Subscription-Token: $BRAVE_API_KEY" | jq '.web.results[:5]'

# Option 2: curl + scrape (no key needed)
curl -s "https://html.duckduckgo.com/html/?q=local+LLM+inference" \
  | python3 -c "
import sys, re
html = sys.stdin.read()
results = re.findall(r'class=\"result__title\".*?<a.*?href=\"(.*?)\".*?>(.*?)</a>', html, re.DOTALL)
for url, title in results[:5]:
    print(f'{title.strip()}: {url}')
"
```

Then pass the search results as context to your local or API-based LLM for summarization.

## Advanced usage

### Search with domain focus

```bash
curl -s https://api.perplexity.ai/chat/completions \
  -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sonar",
    "messages": [
      {"role": "system", "content": "Focus on academic and research sources."},
      {"role": "user", "content": "Latest papers on mixture of experts architectures"}
    ],
    "search_domain_filter": ["arxiv.org", "scholar.google.com"]
  }' | jq '.choices[0].message'
```

### Get citations

The response includes a `citations` array with source URLs. Always present these to the user for verification.
