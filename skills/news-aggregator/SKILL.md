---
name: news-aggregator
description: Aggregate news from HN, GitHub Trending, Product Hunt, and 5+ more sources.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "📰",
        "requires": { "bins": ["node"] },
      },
  }
---

# News Aggregator

Aggregate and summarize news from multiple tech sources — Hacker News, GitHub Trending, Product Hunt, Reddit, TechCrunch, and more.

## When to use

- Get a daily tech news briefing from multiple sources
- Track trending repositories on GitHub
- Monitor Product Hunt launches
- Follow Hacker News top stories
- Get curated news by topic (AI, security, web dev, etc.)

## Quick start

```bash
# Daily briefing from all sources
node {baseDir}/news-aggregator.js briefing --output briefing.md

# Hacker News top stories
node {baseDir}/news-aggregator.js hn --top 20

# GitHub Trending
node {baseDir}/news-aggregator.js github-trending --language typescript --since weekly

# Product Hunt today
node {baseDir}/news-aggregator.js producthunt --today

# Topic-filtered news
node {baseDir}/news-aggregator.js topic --query "AI regulation" --sources hn,reddit,techcrunch
```

## Sources

All sources use free, public APIs — no API key required:

1. **Hacker News** — Algolia API (free)
2. **GitHub Trending** — github-trending-api (free)
3. **Product Hunt** — Public feed (free)
4. **Reddit** — Public JSON API (free)
5. **TechCrunch** — RSS feed (free)
6. **Lobsters** — Public API (free)
7. **Dev.to** — Public API (free)
8. **ArXiv** — Public API (free, for research papers)

## Capabilities (no API key needed)

모든 소스가 무료 공개 API를 사용합니다. API key 불필요.

- **멀티소스 집계** — 8개 이상 뉴스 소스에서 동시 수집
- **토픽 필터링** — 관심 주제별 뉴스 필터링
- **트렌딩 추적** — GitHub 트렌딩, HN 인기 스토리 추적
- **마크다운 브리핑** — 정리된 브리핑 문서 자동 생성
- **RSS 지원** — 커스텀 RSS 피드 추가 가능
