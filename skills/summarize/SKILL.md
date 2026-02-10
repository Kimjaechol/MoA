---
name: summarize
description: Summarize or extract text/transcripts from URLs, podcasts, and local files (great fallback for “transcribe this YouTube/video”).
homepage: https://summarize.sh
metadata:
  {
    "openclaw":
      {
        "emoji": "🧾",
        "requires": { "bins": ["summarize"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "steipete/tap/summarize",
              "bins": ["summarize"],
              "label": "Install summarize (brew)",
            },
          ],
      },
  }
---

# Summarize

Fast CLI to summarize URLs, local files, and YouTube links.

## When to use (trigger phrases)

Use this skill immediately when the user asks any of:

- “use summarize.sh”
- “what’s this link/video about?”
- “summarize this URL/article”
- “transcribe this YouTube/video” (best-effort transcript extraction; no `yt-dlp` needed)

## Quick start

```bash
summarize "https://example.com" --model google/gemini-3-flash-preview
summarize "/path/to/file.pdf" --model google/gemini-3-flash-preview
summarize "https://youtu.be/dQw4w9WgXcQ" --youtube auto
```

## YouTube: summary vs transcript

Best-effort transcript (URLs only):

```bash
summarize "https://youtu.be/dQw4w9WgXcQ" --youtube auto --extract-only
```

If the user asked for a transcript but it’s huge, return a tight summary first, then ask which section/time range to expand.

## Model + keys

Set the API key for your chosen provider:

- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_API_KEY`
- xAI: `XAI_API_KEY`
- Google: `GEMINI_API_KEY` (aliases: `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY`)

Default model is `google/gemini-3-flash-preview` if none is set.

## Useful flags

- `--length short|medium|long|xl|xxl|<chars>`
- `--max-output-tokens <count>`
- `--extract-only` (URLs only)
- `--json` (machine readable)
- `--firecrawl auto|off|always` (fallback extraction)
- `--youtube auto` (Apify fallback if `APIFY_API_TOKEN` set)

## Config

Optional config file: `~/.summarize/config.json`

```json
{ "model": "openai/gpt-5.2" }
```

Optional services:

- `FIRECRAWL_API_KEY` for blocked sites
- `APIFY_API_TOKEN` for YouTube fallback

## API Key Benefits

API key를 설정하면:

- **고품질 요약** — GPT-5, Claude, Gemini Pro 등 최고 성능 모델 사용
- **긴 문서 처리** — 대용량 PDF, 논문, 책 전체 요약
- **YouTube 트랜스크립트** — Apify API로 자막이 없는 영상도 추출
- **차단된 사이트** — Firecrawl API로 paywall/로그인 차단 사이트도 추출

하지만 API key 없이도 기본 무료 모델(`google/gemini-3-flash-preview`)을 사용하므로 대부분의 요약 작업을 수행할 수 있습니다.

## Free Fallback (API key 없이)

1. **Google Gemini Flash (기본값)** — `GEMINI_API_KEY`가 없어도 무료 할당량 내에서 동작
2. **--extract-only 모드** — 모델 없이 텍스트만 추출 (API key 불필요)
3. **curl + 로컬 파싱** — URL 콘텐츠를 직접 가져와서 로컬 처리
4. **Ollama 로컬 모델** — 로컬 LLM으로 요약 수행

```bash
# 텍스트만 추출 (API key 불필요)
summarize "https://example.com" --extract-only

# curl로 직접 추출 후 로컬 처리
curl -s "https://example.com" | python3 -c "
import sys, html.parser
# simple HTML to text extraction
"
```
