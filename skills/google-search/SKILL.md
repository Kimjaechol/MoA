---
name: google-search
description: Web search via Google Custom Search Engine (Programmable Search Engine) API.
homepage: https://developers.google.com/custom-search
metadata:
  {
    "openclaw":
      {
        "emoji": "🔍",
        "requires": { "bins": ["node"] },
        "primaryEnv": "GOOGLE_CSE_API_KEY",
      },
  }
---

# Google Search

Web search via Google Custom Search Engine (Programmable Search Engine) API. Get structured Google search results in JSON format.

## When to use

- Search the web with Google-quality results
- Get structured search results (title, snippet, URL)
- Search specific sites or the entire web
- Get image search results
- Perform localized searches (country, language)

## Quick start (with API key)

```bash
export GOOGLE_CSE_API_KEY="your-api-key"
export GOOGLE_CSE_ID="your-search-engine-id"

curl "https://www.googleapis.com/customsearch/v1?key=$GOOGLE_CSE_API_KEY&cx=$GOOGLE_CSE_ID&q=AI+regulation+2026"
```

## API Key Setup

1. Go to https://console.cloud.google.com → APIs & Services → Credentials
2. Create an API key
3. Enable "Custom Search API" in the API library
4. Create a Programmable Search Engine at https://programmablesearchengine.google.com
5. Export:

```bash
export GOOGLE_CSE_API_KEY="your-api-key"
export GOOGLE_CSE_ID="your-search-engine-id"
```

## API Key Benefits

Google CSE API key를 설정하면:

- **Google 검색 품질** — 실제 Google 검색 결과와 동일한 품질
- **일 100회 무료** — Google CSE API 무료 할당량
- **구조화된 JSON** — 제목, 스니펫, URL이 깔끔한 JSON으로 제공
- **이미지 검색** — searchType=image 파라미터로 이미지 검색
- **사이트 제한** — 특정 도메인만 검색하도록 제한 가능

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **brave-search 스킬** — 프라이버시 친화 웹 검색
2. **DuckDuckGo** — 완전 무료 검색 API
3. **openclaw-serper 스킬** — Serper API 기반 Google 검색 (2,500회 무료)
4. **agent-browser 스킬** — Playwright로 직접 검색

```bash
# DuckDuckGo 무료 검색
curl -s "https://api.duckduckgo.com/?q=your+query&format=json" | jq '.AbstractText'
```
