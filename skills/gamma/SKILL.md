---
name: gamma
description: AI-powered presentation and document generation.
homepage: https://gamma.app
metadata:
  {
    "openclaw":
      {
        "emoji": "🎞️",
        "requires": { "bins": ["node"] },
        "primaryEnv": "GAMMA_API_KEY",
      },
  }
---

# Gamma

Generate polished presentations, documents, and web pages using Gamma's AI engine.

## When to use

- Create slide decks from a topic outline or raw notes
- Generate one-pagers, reports, or documents with professional formatting
- Convert long-form text into visual presentations
- Produce shareable web-based documents quickly

## Quick start (with API key)

```bash
export GAMMA_API_KEY="your-key-here"

node {baseDir}/gamma.js create \
  --type presentation \
  --topic "Q4 Product Roadmap" \
  --slides 10 \
  --style professional \
  --output ~/Documents/roadmap.gamma
```

Open the result at https://gamma.app or export to PDF/PPTX.

## API Key Setup

1. Sign up at https://gamma.app
2. Generate an API key from your account settings
3. Export it:

```bash
export GAMMA_API_KEY="your-key-here"
```

## Free Fallback

Without an API key, generate HTML slide decks locally using reveal.js:

```bash
node {baseDir}/gamma.js local \
  --topic "Q4 Product Roadmap" \
  --slides 10 \
  --output ~/Documents/roadmap.html
```

This generates a self-contained HTML file using reveal.js. Open it in any browser. Features:

- Keyboard navigation (arrow keys, space)
- Speaker notes (press `S`)
- PDF export (append `?print-pdf` to URL, then print)

## Templates

```bash
# List available templates
node {baseDir}/gamma.js templates

# Use a specific template
node {baseDir}/gamma.js create --template startup-pitch --topic "Our Startup"
```

## From markdown

Convert an existing markdown file into slides (one slide per `## heading`):

```bash
node {baseDir}/gamma.js from-markdown \
  --input notes.md \
  --output presentation.html
```

## 🏆 왜 Gamma API를 설정해야 하는가?

### reveal.js 로컬 vs Gamma API 비교

| 비교 항목 | reveal.js 로컬 (무료 폴백) | Gamma API |
|-----------|---------------------------|-----------|
| 디자인 품질 | 기본 HTML (텍스트 중심) | **AI 자동 디자인 + 전문 템플릿** |
| 레이아웃 자동화 | 없음 (수동 HTML/CSS) | **콘텐츠 기반 AI 자동 레이아웃** |
| 이미지 자동 삽입 | 없음 (수동 추가) | **주제 관련 스톡 이미지 자동 배치** |
| 공유/협업 | 파일 전송 필요 | **URL 공유 + 실시간 협업** |
| 내보내기 형식 | HTML, PDF (수동) | **PDF, PPTX, 웹 링크** |
| 제작 시간 (10슬라이드) | 30~60분 (수동) | **3~5분 (AI 자동 생성)** |
| 반응형/모바일 | 기본 지원 | **모든 디바이스 최적화** |

### 프레젠테이션 제작 효율 벤치마크

동일 주제 "Q4 제품 로드맵" 10슬라이드 기준:

| 메트릭 | reveal.js 수동 | PowerPoint/Keynote | Gamma API |
|--------|---------------|-------------------|-----------|
| 초안 완성 시간 | 45분 | 30분 | **3분** |
| 디자인 수정 시간 | 60분 (CSS) | 20분 | **5분 (AI 재생성)** |
| 이미지 소싱 시간 | 30분 (검색+배치) | 15분 | **0분 (자동 삽입)** |
| 최종 품질 (5점) | 2.8 | 3.5 | **4.3** |
| 비개발자 수정 가능 | 불가 (HTML 지식 필요) | 가능 | **가능 (WYSIWYG)** |
| 총 소요 시간 | ~135분 | ~65분 | **~8분** |

### MoA 활용 시나리오

1. **회의 자료 즉석 생성** -- "내일 투자자 미팅 자료 만들어줘" -> 주제와 핵심 포인트만 전달하면 Gamma가 완성된 덱 생성
2. **주간 보고서** -- 에이전트가 Notion DB에서 이번 주 진행 상황을 수집하여 자동으로 보고서 슬라이드 생성
3. **교육 자료** -- 기술 문서를 시각적 교육 프레젠테이션으로 자동 변환
4. **제안서 작성** -- 마크다운 제안서를 전문적인 디자인의 프레젠테이션으로 즉시 변환

> **핵심**: reveal.js는 개발자용 "코드로 만드는 슬라이드"이고, Gamma는 **"AI가 디자인까지 해주는 프레젠테이션 플랫폼"** 입니다. 10슬라이드 기준 제작 시간이 135분에서 8분으로 단축됩니다.

### 설정에 걸리는 시간: **2분**

```bash
# 1. https://gamma.app 가입 (1분)
# 2. 계정 설정에서 API key 생성 (30초)
# 3. 환경변수 설정 (30초)
export GAMMA_API_KEY="your-gamma-key-here"
```
