---
name: openclaw-serper
description: Google Search with full page content extraction via Serper API.
homepage: https://serper.dev
metadata:
  {
    "openclaw":
      {
        "emoji": "🔎",
        "requires": { "bins": ["node"] },
        "primaryEnv": "SERPER_API_KEY",
      },
  }
---

# OpenClaw Serper

Google Search results plus full page content extraction powered by the Serper API. Get Google-quality search results with the full text of linked pages.

## When to use

- Perform Google searches with structured JSON results
- Extract full page content from search result URLs
- Get Google News, Images, Videos, Shopping results
- Scrape and parse web pages for research
- Build research workflows with real Google data

## Quick start (with API key)

```bash
export SERPER_API_KEY="your-key-here"

# Google search
curl -X POST "https://google.serper.dev/search" \
  -H "X-API-KEY: $SERPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"q": "latest AI regulations 2026"}'

# Google News
curl -X POST "https://google.serper.dev/news" \
  -H "X-API-KEY: $SERPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"q": "AI regulation", "gl": "kr", "hl": "ko"}'
```

## API Key Setup

1. Sign up at https://serper.dev (2,500 free searches included)
2. Copy your API key from the dashboard
3. Export it:

```bash
export SERPER_API_KEY="your-key-here"
```

## API Key Benefits

Serper API key를 설정하면:

- **Google 검색 품질** — 실제 Google 검색 결과 접근
- **구조화된 JSON** — 파싱 불필요, 즉시 활용 가능한 결과
- **다양한 검색** — 웹, 뉴스, 이미지, 동영상, 쇼핑 결과
- **한국어 지원** — gl=kr, hl=ko 파라미터로 한국 검색
- **무료 할당량** — 가입 시 2,500회 무료 검색 제공

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **brave-search 스킬** — 프라이버시 친화 웹 검색
2. **DuckDuckGo** — 완전 무료 검색 API
3. **curl + 웹 스크래핑** — 공개 웹 페이지 직접 추출
4. **agent-browser 스킬** — Playwright로 Google 검색 자동화

```bash
# DuckDuckGo 무료 대안
curl -s "https://api.duckduckgo.com/?q=your+query&format=json"
```
