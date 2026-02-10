---
name: brave-search
description: "Privacy-first web search via the Brave Search API. Falls back to DuckDuckGo HTML scraping when no API key is configured."
homepage: https://brave.com/search/api/
metadata:
  {
    "openclaw":
      {
        "emoji": "🦁",
        "requires": { "bins": ["curl"] },
      },
  }
---

# Brave Search

Privacy-first web search. Uses the Brave Search API for high-quality results with
snippet summaries, news, and entity info. Falls back to DuckDuckGo scraping when
no API key is available.

## When to use

- "search the web for ..."
- "find recent news about ..."
- "look up ..." / "what is the latest on ..."
- Any request needing current information beyond training data
- Research tasks, fact-checking, finding documentation links

## Quick start

### With API key (recommended)

```bash
curl -s "https://api.search.brave.com/res/v1/web/search?q=rust+async+tutorial" \
  -H "Accept: application/json" \
  -H "X-Subscription-Token: $BRAVE_SEARCH_API_KEY" | jq '.web.results[:5] | .[] | {title, url, description}'
```

### News search

```bash
curl -s "https://api.search.brave.com/res/v1/news/search?q=openai&count=5" \
  -H "Accept: application/json" \
  -H "X-Subscription-Token: $BRAVE_SEARCH_API_KEY" | jq '.results[:5] | .[] | {title, url, age}'
```

### Summarized search (AI snippet)

```bash
curl -s "https://api.search.brave.com/res/v1/web/search?q=how+does+RLHF+work&summary=1" \
  -H "Accept: application/json" \
  -H "X-Subscription-Token: $BRAVE_SEARCH_API_KEY" | jq '{summary: .summarizer, top: .web.results[:3] | .[].title}'
```

## API Key Setup

1. Go to https://brave.com/search/api/ and create a free account.
2. Generate an API key from the dashboard.
3. Export the key:

```bash
export BRAVE_SEARCH_API_KEY="BSA-xxxxxxxxxxxxxxxxxxxxxxxx"
```

Or persist it:

```bash
openclaw config set env.BRAVE_SEARCH_API_KEY "BSA-xxxxxxxxxxxxxxxxxxxxxxxx"
```

The free tier provides 2,000 queries/month, which is sufficient for most agent usage.
The paid tier ($3/1000 queries) adds AI summaries and higher rate limits.

## Free Fallback

When `BRAVE_SEARCH_API_KEY` is not set, MoA automatically falls back to DuckDuckGo
HTML scraping via curl. No API key or account required.

```bash
# DuckDuckGo HTML scrape fallback
curl -s "https://html.duckduckgo.com/html/?q=rust+async+tutorial" \
  -H "User-Agent: Mozilla/5.0" \
  | sed -n 's/.*class="result__a" href="\([^"]*\)".*/\1/p' \
  | head -10
```

```bash
# Extract titles + URLs from DuckDuckGo results
curl -s "https://html.duckduckgo.com/html/?q=openai+news" \
  -H "User-Agent: Mozilla/5.0" \
  | grep -oP 'class="result__a"[^>]*href="\K[^"]+' \
  | head -5
```

Limitations of the fallback:
- No structured JSON -- results are scraped from HTML
- No news-specific endpoint
- No AI summaries
- Rate-limited by DuckDuckGo (no SLA)

For best results, configure `BRAVE_SEARCH_API_KEY`.
