---
name: parallel
description: High-accuracy web search and research via Parallel.ai API.
homepage: https://parallel.ai
metadata:
  {
    "openclaw":
      {
        "emoji": "🔀",
        "requires": { "bins": ["node"] },
        "primaryEnv": "PARALLEL_API_KEY",
      },
  }
---

# Parallel

High-accuracy web search and multi-step research powered by Parallel.ai. Performs grounded searches with source citations and cross-verification.

## When to use

- Conduct deep web research with source verification
- Find accurate, up-to-date information with citations
- Cross-reference multiple sources on a topic
- Perform multi-step research workflows
- Get grounded answers with linked sources

## Quick start (with API key)

```bash
export PARALLEL_API_KEY="your-key-here"

node {baseDir}/parallel.js search \
  --query "latest Supreme Court rulings on AI copyright 2026" \
  --depth deep \
  --output results.json
```

## API Key Setup

1. Sign up at https://parallel.ai
2. Get your API key from the dashboard
3. Export it:

```bash
export PARALLEL_API_KEY="your-key-here"
```

## API Key Benefits

Parallel API key를 설정하면:

- **고정확도 검색** — 소스 교차 검증으로 신뢰도 높은 결과
- **딥 리서치** — 다단계 검색으로 복잡한 주제 조사
- **소스 인용** — 모든 결과에 출처 링크 포함
- **실시간 정보** — 최신 웹 콘텐츠 기반 응답

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **brave-search 스킬** — 프라이버시 친화 웹 검색
2. **perplexity 스킬** — AI 기반 검색 (API key 있을 경우)
3. **curl + DuckDuckGo** — 무료 웹 검색 API

```bash
# DuckDuckGo 무료 검색
curl -s "https://api.duckduckgo.com/?q=Supreme+Court+AI+copyright&format=json" | jq '.AbstractText'

# brave-search 스킬 활용
# brave-search가 설치되어 있으면 자동으로 폴백
```
