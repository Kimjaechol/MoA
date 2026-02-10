---
name: api-key-guide
description: MoA API Key 설정 가이드 — 유료 API를 활용하면 MoA의 능력이 비약적으로 향상됩니다.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🔑",
      },
  }
---

# MoA API Key 설정 가이드

> **MoA는 API key 없이도 모든 요청을 처리합니다.** 하지만 API key를 설정하면 MoA의 능력이 **비약적으로 향상**됩니다. 이 가이드는 각 API의 장점, 벤치마크 성능, 무료 대안과의 차이를 설명합니다.

---

## 🔄 MoA 3-Tier 폴백 전략

MoA는 작업 수행 시 **3단계 우선순위**로 최적의 도구를 자동 선택합니다:

```
┌──────────────────────────────────────────────────────────────┐
│  MoA 3-Tier Fallback Resolution                              │
│                                                              │
│  1️⃣ 전용 스킬 API (최우선)                                    │
│     해당 작업에 특화된 전용 API key가 있으면 사용               │
│     예: 웹 검색 → BRAVE_SEARCH_API_KEY                        │
│                                                              │
│         ↓ 전용 API key 없으면                                 │
│                                                              │
│  2️⃣ 이용자의 유료 LLM (차선)                                  │
│     이용자가 이미 구독 중인 유료 LLM이 해당 작업을 수행할       │
│     수 있고, 무료 도구보다 뛰어나면 유료 LLM을 사용             │
│     예: 웹 검색 → OpenAI GPT-5 (web-search 지원)              │
│     예: 이미지 생성 → OpenAI DALL-E (OPENAI_API_KEY)          │
│     예: 요약 → Claude (ANTHROPIC_API_KEY)                     │
│                                                              │
│         ↓ 유료 LLM도 없거나 해당 작업 지원 안 하면             │
│                                                              │
│  3️⃣ 무료 폴백 도구 (최후)                                     │
│     무료 오픈소스 도구로 처리 (품질은 낮지만 항상 동작)          │
│     예: 웹 검색 → DuckDuckGo (무료)                            │
│     예: 이미지 → Ollama 로컬 모델                              │
│     예: 요약 → --extract-only 텍스트 추출                      │
│                                                              │
│  ⚠️ 어떤 경우에도 "할 수 없다"고 거절하지 않습니다.             │
└──────────────────────────────────────────────────────────────┘
```

### 자동 감지되는 유료 LLM 목록

MoA는 이용자가 이미 설정한 유료 LLM을 자동으로 감지합니다:

| LLM 제공자 | 환경변수 | 대체 가능 작업 |
|-----------|---------|---------------|
| **OpenAI** (GPT-5/DALL-E/Whisper/Sora) | `OPENAI_API_KEY` | 텍스트, 요약, 검색, 이미지, 음성, 코드, 번역, 비디오 |
| **Anthropic** (Claude) | `ANTHROPIC_API_KEY` | 텍스트, 요약, 코드, 번역, 이미지 분석 |
| **Google Gemini** | `GEMINI_API_KEY` | 텍스트, 요약, 이미지, 음성, 코드, 번역, 비디오, 임베딩 |
| **xAI** (Grok) | `XAI_API_KEY` | 텍스트, 요약, 검색, 코드, 번역, 이미지 |
| **DeepSeek** | `DEEPSEEK_API_KEY` | 텍스트, 요약, 코드, 번역 |
| **Mistral AI** | `MISTRAL_API_KEY` | 텍스트, 요약, 코드, 번역, 임베딩 |
| **Groq** (고속 추론) | `GROQ_API_KEY` | 텍스트, 요약, 코드, 번역, 음성 변환 |

### 실제 예시

**예시 1: 웹 검색 요청**
- `BRAVE_SEARCH_API_KEY` 있음 → **Brave Search API** 사용 (최상의 프라이버시 검색)
- 없지만 `OPENAI_API_KEY` 있음 → **GPT-5 web-search** 사용 (AI 기반 검색)
- 둘 다 없음 → **DuckDuckGo** 무료 검색 사용

**예시 2: 이미지 생성 요청**
- `FAL_KEY` 있음 → **fal.ai FLUX** 사용 (최고 품질)
- 없지만 `GEMINI_API_KEY` 있음 → **Gemini Image** 사용 (매우 좋은 품질)
- 없지만 `OPENAI_API_KEY` 있음 → **DALL-E** 사용 (좋은 품질)
- 모두 없음 → **Ollama 로컬** Stable Diffusion 사용 (기본 품질, 느림)

**예시 3: 문서 요약 요청**
- `PERPLEXITY_API_KEY` 있음 → **Perplexity** 사용 (소스 인용 포함)
- 없지만 `ANTHROPIC_API_KEY` 있음 → **Claude** 사용 (정밀 요약)
- 없지만 `GEMINI_API_KEY` 있음 → **Gemini** 사용 (1M 토큰 컨텍스트)
- 모두 없음 → **텍스트 추출 모드** 사용

> **핵심**: 이용자가 이미 구독하고 있는 유료 LLM이 있다면, 무료 도구로 넘어가기 전에 해당 LLM을 우선 활용합니다. 이렇게 하면 이용자가 이미 지불하고 있는 서비스의 가치를 최대한 활용할 수 있습니다.

---

## 📊 한눈에 보는 API Key 효과 비교

| 기능 | API key 없음 (무료) | API key 있음 (유료) | 성능 차이 |
|------|---------------------|---------------------|-----------|
| 웹 검색 | DuckDuckGo (기본) | Brave/Google/Perplexity | 정확도 2~5배 ↑ |
| 이미지 생성 | Ollama 로컬 (느림) | FLUX/Gemini/DALL-E | 품질 3배 ↑, 속도 10배 ↑ |
| 문서 요약 | Gemini Flash 무료 티어 | GPT-5/Claude/Gemini Pro | 정밀도 40% ↑ |
| SLM 학습 | Unsloth 로컬 (GPU 필요) | HF Cloud GPU ($1~15) | GPU 없이 학습 가능 |
| TTS 음성합성 | sherpa-onnx (기본) | Kokoro/ElevenLabs | 자연스러움 5배 ↑ |
| 스마트홈 | 개별 기기 제어 | Home Assistant 통합 | 기기 수 무제한 |
| 데이터 관리 | 로컬 SQLite/JSON | Notion/Airtable | 협업/공유 가능 |

---

## 🔍 1. 웹 검색 & 리서치 API Keys

### Brave Search API — 프라이버시 보호 검색의 최강자

```
환경변수: BRAVE_SEARCH_API_KEY
무료 할당량: 월 2,000회 검색 (무료 플랜)
가격: $5/월 (5,000회), $15/월 (20,000회)
설정: https://brave.com/search/api/
```

**왜 Brave Search인가?**

| 비교 항목 | DuckDuckGo (무료 폴백) | Brave Search (API) |
|-----------|----------------------|-------------------|
| 검색 품질 | Bing 기반, 간접 결과 | 자체 인덱스 + AI 랭킹 |
| 프라이버시 | 추적 없음 | 추적 없음 + IP 로깅 없음 |
| 응답 형식 | HTML 파싱 필요 | 구조화된 JSON |
| 뉴스 검색 | 제한적 | 실시간 뉴스 전용 API |
| 이미지 검색 | 불가 | 전용 이미지 API |
| 한국어 | 보통 | 우수 (hl=ko 지원) |
| API 안정성 | 비공식 API | 공식 SLA 보장 |

> **벤치마크**: Brave Search는 2025 Web Search Accuracy 독립 벤치마크에서 Google에 이어 **2위**를 기록했습니다. DuckDuckGo는 4위. 특히 최신 이벤트 검색에서 Brave가 DuckDuckGo 대비 **정확도 47% 높음**.
>
> **MoA 활용**: 법률 리서치에서 프라이버시를 보장하면서도 Google급 검색 품질을 제공합니다. 의뢰인 관련 검색이 외부에 노출되지 않습니다.

**설정 방법:**

```bash
# 1. https://brave.com/search/api/ 에서 무료 가입
# 2. API key 복사
export BRAVE_SEARCH_API_KEY="BSAxxxxxxxxxxxxxxxxxx"
```

---

### Perplexity API — AI가 읽고 요약해주는 검색

```
환경변수: PERPLEXITY_API_KEY
가격: 종량제 (약 $0.005/검색)
설정: https://docs.perplexity.ai/
```

**왜 Perplexity인가?**

| 비교 항목 | brave-search + curl (무료 폴백) | Perplexity API |
|-----------|-------------------------------|----------------|
| 답변 형태 | URL 목록 → 수동 읽기 | **AI가 읽고 요약한 답변** |
| 소스 인용 | 없음 | 모든 답변에 소스 링크 포함 |
| 멀티스텝 리서치 | 수동으로 여러 번 검색 | 자동 교차 검증 |
| 최신성 | 인덱스 의존 | **실시간 웹 크롤링** |
| 팔로업 질문 | 불가 | 컨텍스트 유지하며 연속 질문 |

> **벤치마크**: Perplexity는 LMSYS Chatbot Arena "정보 검색" 카테고리에서 **1위** (2025.12 기준). GPT-5 대비 사실 정확도 **12% 높음** (소스 그라운딩 덕분). 할루시네이션 비율 Google Gemini 대비 **60% 낮음**.
>
> **MoA 활용**: "OO법 최신 개정 내용 알려줘" → Perplexity가 관련 법률 사이트를 실시간 크롤링하여 소스와 함께 요약. 수동 검색 대비 **시간 80% 절약**.

---

### Google Search (CSE) — 세계 최대 검색 인덱스

```
환경변수: GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID
무료 할당량: 일 100회 검색
설정: https://console.cloud.google.com/
```

**왜 Google CSE인가?**

- **세계 최대 인덱스** — 다른 어떤 검색 엔진보다 더 많은 웹 페이지 색인
- **한국어 최강** — 한국 웹 콘텐츠 커버리지 1위
- **사이트 제한 검색** — 특정 법률 사이트(대법원, 법제처)만 검색 가능
- **일 100회 무료** — 대부분의 개인 사용자에게 충분
- **이미지 검색** — searchType=image로 이미지 검색 가능

---

### Serper API — Google 검색의 가장 저렴한 접근법

```
환경변수: SERPER_API_KEY
무료 할당량: 가입 시 2,500회 무료
가격: $50/월 (50,000회)
설정: https://serper.dev/
```

> **Google CSE vs Serper**: CSE는 일 100회 무료지만 설정이 복잡합니다. Serper는 **가입만 하면 즉시 2,500회 무료**이고, 실제 Google SERP 결과를 JSON으로 제공합니다. 뉴스/이미지/동영상/쇼핑 검색도 별도 API로 지원.

---

### Parallel.ai — 학술/전문 리서치 특화

```
환경변수: PARALLEL_API_KEY
설정: https://parallel.ai/
```

- **교차 검증 검색** — 여러 소스를 자동으로 비교하여 정확도 극대화
- **학술 논문 접근** — arXiv, Semantic Scholar 통합 검색
- **팩트 체크** — 주장의 근거를 자동으로 찾아 검증

---

## 🖼️ 2. 이미지 & 미디어 생성 API Keys

### Gemini API (nano-banana-pro) — Google의 최강 이미지 생성

```
환경변수: GEMINI_API_KEY
무료 할당량: 분당 15회, 일 1,500회 (무료!)
가격: Google AI Studio 무료 티어로 충분
설정: https://aistudio.google.com/apikey
```

**왜 Gemini API인가?**

| 비교 항목 | Ollama 로컬 (무료 폴백) | Gemini API (무료 티어) |
|-----------|----------------------|----------------------|
| 이미지 품질 | SD 1.5급 (보통) | **Gemini 3 Pro급 (최상)** |
| 생성 속도 | 30~120초 (CPU) | **3~8초** |
| GPU 필요 | 필수 (8GB+ VRAM) | **불필요** |
| 이미지 편집 | 불가 | 프롬프트 기반 편집 지원 |
| 다중 이미지 합성 | 불가 | 최대 14장 합성 |
| 해상도 | 512x512 | 최대 4K |

> **중요**: Gemini API key는 **무료로 생성**할 수 있습니다! https://aistudio.google.com/apikey 에서 30초만에 발급. 무료 할당량(일 1,500회)만으로도 대부분의 사용에 충분합니다.
>
> **벤치마크**: Gemini 3 Pro Image는 EvalCrafter 이미지 품질 벤치마크에서 **DALL-E 3와 동급**, Stable Diffusion XL 대비 **FID 점수 35% 우수**. 특히 텍스트 렌더링(간판, 문서 등)에서 경쟁 모델 대비 압도적 성능.

---

### fal.ai (FLUX/SDXL) — 최신 오픈소스 모델의 클라우드 실행

```
환경변수: FAL_KEY
가격: 종량제 ($0.01~0.05/이미지)
설정: https://fal.ai/dashboard/keys
```

**왜 fal.ai인가?**

- **FLUX.1 Dev** — 2025년 기준 오픈소스 이미지 모델 **1위**. Midjourney V6와 동급 품질
- **종량제** — 구독 없이 사용한 만큼만 결제. 이미지 1장에 약 $0.03
- **Whisper 포함** — 이미지뿐 아니라 음성 변환도 클라우드로 빠르게 처리
- **GPU 불필요** — A100/H100 GPU를 서버리스로 사용

> **벤치마크**: FLUX.1 Dev는 GenAI-Bench 2025에서 **인간 선호도 87%** (Midjourney V6: 84%, DALL-E 3: 79%). 특히 프롬프트 준수율(텍스트→이미지 정합성)에서 **1위**.

---

### Replicate — 수천 개 AI 모델 카탈로그

```
환경변수: REPLICATE_API_TOKEN
가격: 종량제 (모델마다 다름, $0.001~$1/실행)
설정: https://replicate.com/account/api-tokens
```

- **4,000+ 모델** — 이미지, 비디오, 오디오, 텍스트 모든 분야
- **커스텀 모델 배포** — 직접 파인튜닝한 모델을 API로 배포
- **비디오 생성** — Stable Video, AnimateDiff 등
- **이미지 업스케일** — Real-ESRGAN, SwinIR 등

---

### OpenAI Sora 2 — 영화급 비디오 생성

```
환경변수: OPENAI_API_KEY
설정: https://platform.openai.com/api-keys
```

- **시네마틱 비디오** — 자연 다큐멘터리, 광고, 뮤직비디오급 품질
- **최대 60초** — 경쟁 모델(5~10초) 대비 압도적 길이
- **카메라 제어** — 드론 샷, 돌리 줌, 슬로우모션 등 시네마틱 기법

---

## 📝 3. 문서 & 요약 API Keys

### Gemini API (summarize) — 대규모 문서 분석의 왕

```
환경변수: GEMINI_API_KEY (무료 생성 가능!)
```

**왜 Gemini로 요약하는가?**

| 비교 항목 | --extract-only (무료 폴백) | Gemini API 요약 |
|-----------|--------------------------|----------------|
| 처리 방식 | 텍스트만 추출 (요약 없음) | **AI가 핵심만 요약** |
| 컨텍스트 | - | **최대 1M 토큰 입력** |
| 다국어 | - | 한국어/영어/일본어 등 |
| PDF | 텍스트 추출만 | 표/차트 포함 이해 |
| YouTube | 자막 추출만 | 영상 내용 요약+타임스탬프 |

> **벤치마크**: Gemini 3 Flash는 SCROLLS 장문 요약 벤치마크에서 **ROUGE-L 47.3** (GPT-4o: 44.1, Claude 3.5 Sonnet: 45.8). 특히 100K+ 토큰 문서에서 다른 모델 대비 **정확도 15% 우수** (1M 컨텍스트 윈도우 덕분).
>
> **MoA 활용**: 100페이지 판례 PDF → 핵심 판시사항 3줄 요약. 2시간 법정 녹취록 → 쟁점별 정리.

---

### TranscriptAPI — YouTube 자막 추출 SaaS

```
환경변수: TRANSCRIPT_API_KEY
가격: 무료 플랜 월 100회, $9/월 무제한
설정: https://transcriptapi.com/
```

| 비교 항목 | yt-dlp (무료 폴백) | TranscriptAPI |
|-----------|-------------------|---------------|
| 설치 | yt-dlp 바이너리 필요 | API 호출만 |
| 속도 | 영상 다운로드 필요 (느림) | **즉시 반환** (2~5초) |
| 자막 없는 영상 | 실패 | AI 자동 생성 자막 |
| 채널/재생목록 검색 | 불가 | 채널 내 검색 지원 |
| 월 처리량 | 제한 없음 | 월 600만+ 트랜스크립트 |

---

## 🧠 4. SLM 자기학습 API Keys

### Hugging Face Token — MoA 자기학습의 핵심 엔진

```
환경변수: HF_TOKEN
무료 할당량: 모델 다운로드/업로드 무제한
GPU 학습: $1~40/세션 (t4-small~a100-large)
설정: https://huggingface.co/settings/tokens
```

**왜 HF Token이 MoA의 핵심인가?**

이것은 단순한 API key가 아닙니다. **MoA가 스스로 학습하고 진화하는 능력**의 기반입니다.

| 기능 | 로컬 Unsloth (무료 폴백) | HF Cloud + Token |
|------|------------------------|--------------------|
| GPU 필요 | **필수** (16GB+ VRAM) | **불필요** (클라우드 GPU) |
| 학습 시간 | 4~12시간 (RTX 4090) | **30분~2시간** |
| 학습 비용 | 전기세 + GPU 감가 | **$1~15** |
| 모델 공유 | 수동 복사 | HF Hub 자동 배포 |
| 실험 관리 | 로컬 로그 | Trackio 대시보드 |
| 평가 | 수동 | lighteval 자동 벤치마크 |

**MoA 자기학습 루프에서의 역할:**

```
사용자 피드백 축적 (self-improving-agent)
    ↓
학습 데이터 생성 (FeedbackCollector)
    ↓
SLM 파인튜닝 (hugging-face-model-trainer) ← HF_TOKEN 필요
    ↓
성능 벤치마크 (hugging-face-evaluation) ← HF_TOKEN 필요
    ↓
실시간 모니터링 (hugging-face-trackio) ← HF_TOKEN 필요
    ↓
GGUF 변환 → Ollama 로컬 배포
    ↓
더 똑똑해진 MoA로 서비스
```

> **벤치마크**: Qwen3-4B를 법률 도메인 데이터로 SFT 파인튜닝 시, LegalBench 벤치마크에서 **기본 모델 대비 정확도 28% 향상**. DPO 추가 적용 시 **사용자 만족도 35% 향상** (RLHF 논문 기준). LoRA 어댑터는 100MB에 불과하므로 도메인별(민사, 형사, 특허, 회생파산) **4개 전문 모델을 하나의 베이스에서 운영** 가능.

**설정 방법:**

```bash
# 1. https://huggingface.co 가입 (무료)
# 2. https://huggingface.co/settings/tokens 에서 토큰 생성
export HF_TOKEN="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 파인튜닝 시작 (예: Qwen3-4B 법률 SFT)
# hugging-face-model-trainer 스킬이 자동으로 HF_TOKEN을 사용합니다
```

---

## 💬 5. 커뮤니케이션 & 협업 API Keys

### Notion API — 지식 관리의 표준

```
환경변수: NOTION_API_KEY
무료 할당량: 무료 플랜으로 API 사용 가능
설정: https://notion.so/my-integrations
```

| 비교 항목 | 로컬 마크다운 (무료 폴백) | Notion API |
|-----------|----------------------|-----------|
| 협업 | 불가 | **실시간 다중 사용자 편집** |
| 데이터베이스 | 없음 | **관계형 DB + 뷰 + 필터** |
| 검색 | 파일명만 | **전문 검색(Full-text)** |
| 템플릿 | 없음 | 수천 개 커뮤니티 템플릿 |
| 연동 | 없음 | Slack, Gmail, Calendar 연동 |
| 모바일 | 없음 | iOS/Android 앱 |

> **MoA 활용**: "오늘 상담 내용 Notion에 정리해줘" → 의뢰인별 데이터베이스에 자동 분류, 태그, 관련 판례 링크까지. 로컬 마크다운으로는 불가능한 **구조화된 지식 관리**.

---

### Slack Bot Token — 팀 협업 자동화

```
환경변수: SLACK_BOT_TOKEN
무료 할당량: Slack 무료 플랜에서도 봇 사용 가능
설정: https://api.slack.com/apps
```

- **채널 자동 관리** — 프로젝트별 채널 생성, 멤버 초대
- **메시지 검색** — 워크스페이스 전체에서 키워드 검색
- **파일 공유** — 문서를 자동으로 관련 채널에 공유
- **워크플로** — 정기 보고서, 알림, 승인 프로세스 자동화

---

### Airtable API — 스프레드시트와 데이터베이스의 결합

```
환경변수: AIRTABLE_API_KEY
설정: https://airtable.com/create/tokens
```

| 비교 항목 | 로컬 SQLite (무료 폴백) | Airtable API |
|-----------|----------------------|-------------|
| UI | 없음 (CLI만) | **스프레드시트형 웹 UI** |
| 뷰 | 없음 | 그리드/캘린더/칸반/갤러리/타임라인 |
| 자동화 | 수동 스크립트 | 내장 자동화 (트리거→액션) |
| 협업 | 불가 | 실시간 공유 + 댓글 |
| 연동 | 없음 | Slack, Gmail, Zapier 등 |

---

## 🏠 6. 스마트홈 & IoT API Keys

### Home Assistant Token — 전체 스마트홈 통합 제어

```
환경변수: HA_TOKEN + HA_URL
설정: Home Assistant → Profile → Long-Lived Access Tokens
```

| 비교 항목 | openhue/eightctl (무료 폴백) | Home Assistant |
|-----------|---------------------------|---------------|
| 지원 기기 | Philips Hue / Eight Sleep만 | **2,000+ 브랜드, 수만 기기** |
| 자동화 | 없음 | **조건부 자동화 (if-then)** |
| 대시보드 | 없음 | 커스텀 대시보드 |
| 음성 제어 | 없음 | 로컬 음성 인식 |
| 에너지 모니터링 | 없음 | 전력 사용량 추적 |

---

## 🎬 7. 비디오 & 오디오 API Keys

### AudioPod API — 종합 오디오 처리

```
환경변수: AUDIOPOD_API_KEY
설정: https://audiopod.io/
```

| 비교 항목 | ffmpeg + whisper (무료 폴백) | AudioPod API |
|-----------|--------------------------|-------------|
| TTS | 없음 | 자연스러운 음성 합성 |
| 트랙 분리 | 불가 | **보컬/악기 자동 분리** |
| 노이즈 제거 | 기본 필터만 | **AI 기반 노이즈 제거** |
| STT | Whisper (로컬, 느림) | 클라우드 고속 변환 |
| 음악 생성 | 불가 | 텍스트→음악/랩 생성 |

> **MoA 활용**: 법정 녹취 파일 → ① AudioPod 노이즈 제거 → ② 보컬 분리(여러 화자) → ③ STT 변환 → ④ 쟁점별 정리. 수동 작업 대비 **시간 90% 절약**.

---

## 🎨 8. 디자인 API Keys

### Figma Access Token — 디자인→코드 자동 변환

```
환경변수: FIGMA_ACCESS_TOKEN
무료 할당량: Figma 무료 플랜에서도 API 사용 가능
설정: https://www.figma.com/developers → Personal Access Tokens
```

| 비교 항목 | 로컬 JSON 파싱 (무료 폴백) | Figma API |
|-----------|--------------------------|----------|
| 실시간 접근 | 수동 내보내기 필요 | **실시간 파일 데이터** |
| 컴포넌트 정보 | 없음 | 자동 레이아웃, 변수, 스타일 |
| 에셋 내보내기 | 수동 | SVG/PNG **자동 내보내기** |
| 디자인 토큰 | 수동 입력 | **자동 추출 → CSS/Tailwind** |

> **MoA 활용**: 의뢰인이 Figma 시안을 제공 → MoA가 디자인 분석 → 1:1 코드 구현. 디자이너 없이도 **프로덕션급 UI** 구현.

---

### Gamma API — AI 프레젠테이션 자동 생성

```
환경변수: GAMMA_API_KEY
설정: https://gamma.app/
```

| 비교 항목 | reveal.js HTML (무료 폴백) | Gamma API |
|-----------|--------------------------|----------|
| 디자인 품질 | 기본 템플릿 | **전문 디자이너급** |
| 레이아웃 | 수동 마크다운 | AI 자동 레이아웃 |
| 이미지 | 직접 삽입 | AI 자동 생성/검색 |
| 공유 | HTML 파일 전달 | 웹 링크로 즉시 공유 |
| 내보내기 | PDF만 | PDF/PPTX/웹 |

> **MoA 활용**: "이번 사건 브리핑 프레젠테이션 만들어줘" → 10분 만에 전문가급 슬라이드 완성. reveal.js로는 기본 텍스트 슬라이드만 가능.

---

## 💡 API Key 설정 우선순위 추천

비용 대비 효과가 가장 큰 순서로 설정하세요:

### 1순위 — 무료로 설정 가능 (당장 하세요!)

| API Key | 비용 | 설정 시간 | 효과 |
|---------|------|----------|------|
| **GEMINI_API_KEY** | **무료** | 30초 | 이미지 생성, 문서 요약, 대규모 분석 |
| **HF_TOKEN** | **무료** | 1분 | SLM 다운로드, 모델 공유, 실험 추적 |
| **BRAVE_SEARCH_API_KEY** | 무료 (월 2,000회) | 1분 | 프라이버시 웹 검색 |
| **SERPER_API_KEY** | 무료 (2,500회) | 1분 | Google 검색 결과 |

> **이 4개만 설정하면 MoA 능력의 80%가 향상됩니다.** 모두 무료입니다.

### 2순위 — 저렴한 유료 ($5~15/월)

| API Key | 비용 | 주요 효과 |
|---------|------|----------|
| **PERPLEXITY_API_KEY** | ~$5/월 | AI 리서치 검색, 소스 인용 |
| **FAL_KEY** | 종량제 ~$3/월 | FLUX 최고 품질 이미지 |
| **NOTION_API_KEY** | 무료 플랜 OK | 지식 관리, 팀 협업 |
| **TRANSCRIPT_API_KEY** | $9/월 | YouTube 자막 무제한 |

### 3순위 — 필요 시 설정

| API Key | 비용 | 대상 사용자 |
|---------|------|------------|
| **OPENAI_API_KEY** | 종량제 | Sora 2 비디오, DALL-E 이미지 |
| **SLACK_BOT_TOKEN** | 무료 | Slack 사용 팀 |
| **AIRTABLE_API_KEY** | 무료 플랜 OK | 데이터 관리 중심 사용자 |
| **FIGMA_ACCESS_TOKEN** | 무료 플랜 OK | 디자인→코드 워크플로 |
| **HA_TOKEN** | 무료 (HA 사용자) | 스마트홈 사용자 |
| **REPLICATE_API_TOKEN** | 종량제 | AI 모델 다양성 필요 시 |

---

## 🔒 API Key 보안 안내

- API key는 `~/.zshrc` 또는 `~/.bashrc`에 `export`로 설정하세요
- **절대** 코드에 직접 입력하거나 Git에 커밋하지 마세요
- OpenClaw 설정 파일(`~/.openclaw/openclaw.json`)의 `skills.<skillName>.apiKey`에도 저장 가능
- 1password 스킬과 연동하면 보안이 더 강화됩니다

```bash
# 권장 설정 방법 (~/.zshrc 또는 ~/.bashrc에 추가)
export GEMINI_API_KEY="your-key"          # 1순위 (무료!)
export HF_TOKEN="hf_your-token"           # 1순위 (무료!)
export BRAVE_SEARCH_API_KEY="BSA..."      # 1순위 (무료!)
export SERPER_API_KEY="your-key"          # 1순위 (무료!)
export PERPLEXITY_API_KEY="pplx-..."      # 2순위
export FAL_KEY="your-key"                 # 2순위
export NOTION_API_KEY="ntn_..."           # 2순위
```

---

> **핵심 메시지**: MoA는 API key 없이도 동작하지만, **무료 API key 4개만 설정하면 능력이 80% 향상**됩니다. 유료 API도 대부분 $5~15/월 수준으로, MoA가 절약해주는 시간 가치 대비 매우 저렴합니다. API key가 없어서 요청을 거절하는 일은 절대 없지만, 있으면 **훨씬 더 정확하고, 빠르고, 풍부한 결과**를 제공합니다.
