# MoA (Mixture of Agents) - 기술명세서

## ZeroClaw 마이그레이션을 위한 OpenClaw 개선사항 상세 명세

**문서 버전:** 1.0
**작성일:** 2026-02-17
**대상:** Rust 기반 ZeroClaw에 동일 기능을 구현하기 위한 기술명세
**원본 저장소:** MoA (OpenClaw Fork)

---

## 목차

1. [아키텍처 개요](#1-아키텍처-개요)
2. [SLM 로컬 게이트키퍼 시스템](#2-slm-로컬-게이트키퍼-시스템)
3. [멀티 프로바이더 LLM 라우팅](#3-멀티-프로바이더-llm-라우팅)
4. [모델 전략 시스템 (가성비/최고성능)](#4-모델-전략-시스템)
5. [크레딧/빌링 시스템](#5-크레딧빌링-시스템)
6. [보안 가드 시스템](#6-보안-가드-시스템)
7. [보안 미들웨어 (선차단 후 동의)](#7-보안-미들웨어)
8. [행동 권한 시스템](#8-행동-권한-시스템)
9. [E2E 암호화 모듈](#9-e2e-암호화-모듈)
10. [기기 간 메모리 동기화](#10-기기-간-메모리-동기화)
11. [동기화 재조정기 (Sync Reconciler)](#11-동기화-재조정기)
12. [실시간 음성 통역 시스템](#12-실시간-음성-통역-시스템)
13. [의도 분류기 (Intent Classifier)](#13-의도-분류기)
14. [KakaoTalk 채널 통합](#14-kakaotalk-채널-통합)
15. [MoltBot 에이전트 브릿지](#15-moltbot-에이전트-브릿지)
16. [도구 디스패처 시스템](#16-도구-디스패처-시스템)
17. [RAG (법률 정보 검색)](#17-rag-법률-정보-검색)
18. [오프라인 큐 및 복구 시스템](#18-오프라인-큐-및-복구-시스템)
19. [클라우드 디스패처](#19-클라우드-디스패처)
20. [Ollama 자동 설치기](#20-ollama-자동-설치기)
21. [음성 처리 파이프라인](#21-음성-처리-파이프라인)
22. [결제 시스템 (Kakao Pay)](#22-결제-시스템)
23. [Supabase 통합](#23-supabase-통합)
24. [데이터베이스 스키마](#24-데이터베이스-스키마)
25. [2-Tier 로컬 SLM (모바일 확장)](#25-2-tier-로컬-slm-모바일-확장)
26. [모델 자동 선택 (퍼지 매칭)](#26-모델-자동-선택-퍼지-매칭)
27. [모델 폴백 체인](#27-모델-폴백-체인)
28. [웹 앱 크레딧 시스템](#28-웹-앱-크레딧-시스템)
29. [SLM Thinking 모드 제어](#29-slm-thinking-모드-제어)
30. [디바이스 바인딩 암호화](#30-디바이스-바인딩-암호화)
31. [원격 잠금/삭제 (Remote Wipe)](#31-원격-잠금삭제-remote-wipe)
32. [분실 기기 위치 추적](#32-분실-기기-위치-추적)
33. [대화 기록 보호 (Chat History Guard)](#33-대화-기록-보호-chat-history-guard)
34. [암호화 백업 볼트 (Encrypted Vault)](#34-암호화-백업-볼트-encrypted-vault)
35. [명령 안전 가드 (Command Safety Guard)](#35-명령-안전-가드-command-safety-guard)
36. [속도 제한 (3-Strike 시스템)](#36-속도-제한-3-strike-시스템)
37. [보안 감사 시스템](#37-보안-감사-시스템)

---

## 1. 아키텍처 개요

### 1.1 시스템 구조

MoA는 OpenClaw의 에이전트 프레임워크 위에 다음을 추가한 "디바이스 퍼스트" AI 비서 시스템이다:

```
사용자 요청
    │
    ▼
[KakaoTalk 웹훅] ──▶ [보안 미들웨어] ──▶ [의도 분류기]
                           │                    │
                     차단/동의요청          ┌────┴────┐
                                          │         │
                                     [SLM 로컬]  [클라우드 LLM]
                                     Qwen3 0.6B   │
                                          │    ┌──┴──┐
                                          │   가성비  최고성능
                                          │  Gemini  Claude
                                          │  Flash   Opus
                                          │
                                     [도구 디스패처]
                                          │
                              ┌────┬──────┼──────┬────┐
                             날씨  검색  일정  법률RAG  창작
                                          │
                                     [빌링 엔진]
                                     크레딧 차감
                                          │
                                     [E2E 동기화]
                                     기기 간 메모리
```

### 1.2 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **디바이스 퍼스트** | 데이터는 항상 사용자 기기에 존재. 서버는 릴레이만 담당 |
| **선차단 후 동의** | 데이터 유출 의심 시 즉시 차단, 사용자 동의 시에만 해제 |
| **3단 모델 라우팅** | 로컬 SLM → 가성비 클라우드 → 최고성능 클라우드 |
| **오프라인 복원력** | 오프라인 시 SLM이 로컬에서 동작, 재연결 시 자동 복구 |
| **제로 서버 저장** | 서버에 사용자 데이터 영구 저장 없음 (릴레이 + 시그널링만) |

### 1.3 디렉터리 구조

```
MoA/
├── src/
│   ├── slm/                    # SLM 로컬 게이트키퍼 (신규)
│   │   ├── slm-router.ts       # 로컬/클라우드 라우팅 결정
│   │   ├── cloud-dispatcher.ts # 클라우드 위임 파일 생성
│   │   ├── offline-monitor.ts  # 오프라인 상태 모니터링
│   │   ├── ollama-installer.ts # Ollama + 모델 자동 설치
│   │   ├── moa-integration.ts  # OpenClaw 에이전트 통합
│   │   ├── auto-installer.ts   # 설치 자동화
│   │   └── index.ts
│   └── skills/
│       ├── model-strategy.ts   # 모델 전략 해석 (신규)
│       ├── api-key-manager.ts  # API 키 관리 (신규)
│       └── types.ts            # 스킬/전략 타입 정의 (신규)
├── kakaomolt/                  # KakaoTalk 통합 패키지 (전체 신규)
│   └── src/
│       ├── webhook.ts          # KakaoTalk 웹훅 서버
│       ├── channel.ts          # 채널 플러그인
│       ├── model-router.ts     # 멀티 프로바이더 LLM 라우팅
│       ├── billing.ts          # 크레딧/빌링 시스템
│       ├── billing-handler.ts  # 빌링 명령 핸들러
│       ├── payment.ts          # Kakao Pay 결제
│       ├── security-guard.ts   # 보안 위협 탐지
│       ├── security-middleware.ts # 보안 미들웨어
│       ├── action-permissions.ts  # 행동 권한 관리
│       ├── action-guard.ts     # 행동 가드
│       ├── intent-classifier.ts # 의도 분류기
│       ├── tool-dispatcher.ts  # 도구 디스패처
│       ├── user-settings.ts    # 사용자 설정 관리
│       ├── lawcall-router.ts   # 법률 상담 라우팅
│       ├── config.ts           # KakaoTalk 설정
│       ├── runtime.ts          # 런타임 관리
│       ├── api-client.ts       # KakaoTalk API 클라이언트
│       ├── supabase.ts         # Supabase 클라이언트
│       ├── types.ts            # 타입 정의
│       ├── sync/               # 기기 간 동기화 (전체 신규)
│       │   ├── encryption.ts   # AES-256-GCM E2E 암호화
│       │   ├── memory-sync.ts  # 메모리 동기화 엔진
│       │   ├── sync-reconciler.ts # 동기화 재조정기
│       │   ├── sync-commands.ts   # 동기화 명령어
│       │   └── index.ts
│       ├── voice/              # 음성 처리 (전체 신규)
│       │   ├── realtime-interpreter.ts # 실시간 통역
│       │   ├── realtime-voice.ts      # 실시간 음성
│       │   ├── voice-handler.ts       # 음성 핸들러
│       │   ├── voice-billing.ts       # 음성 빌링
│       │   ├── translation-commands.ts # 번역 명령어
│       │   ├── provider-gemini.ts     # Gemini Live 프로바이더
│       │   ├── provider-openai.ts     # OpenAI Realtime 프로바이더
│       │   ├── provider-interface.ts  # 프로바이더 인터페이스
│       │   └── index.ts
│       ├── tools/              # 도구 모음 (전체 신규)
│       │   ├── weather.ts      # 날씨 조회
│       │   ├── search.ts       # 웹 검색
│       │   ├── calendar.ts     # 일정 관리
│       │   ├── sports.ts       # 스포츠 정보
│       │   ├── public-data.ts  # 공공 데이터
│       │   ├── navigation.ts   # 네비게이션
│       │   ├── creative.ts     # 창작 (이미지/음악)
│       │   └── index.ts
│       ├── rag/                # RAG 시스템 (전체 신규)
│       │   ├── legal-rag.ts    # 법률 정보 RAG
│       │   └── index.ts
│       └── moltbot/            # 에이전트 브릿지 (전체 신규)
│           ├── agent-integration.ts # 에이전트 통합
│           ├── channel-bridge.ts    # 채널 브릿지
│           ├── gateway-client.ts    # 게이트웨이 클라이언트
│           ├── memory-adapter.ts    # 메모리 어댑터
│           ├── tool-bridge.ts       # 도구 브릿지
│           └── index.ts
└── ui/                         # UI 관련 파일 (신규)
```

---

## 2. SLM 로컬 게이트키퍼 시스템

**파일:** `src/slm/slm-router.ts`
**목적:** 로컬 소형 언어 모델(SLM)을 항상 가동하여 경량 작업은 로컬에서 처리하고, 복잡한 작업만 클라우드로 위임

### 2.1 모델 사양

| 항목 | 값 |
|------|-----|
| 모델 | Qwen3 0.6B (Q4_K_M 양자화) |
| 크기 | ~400MB |
| 실행 엔진 | Ollama (로컬) |
| API 엔드포인트 | `http://127.0.0.1:11434/v1` |
| 역할 | 게이트키퍼 (의도분류, 간단응답, Heartbeat) |

### 2.2 SLM이 수행하는 6가지 역할

```rust
enum SlmTask {
    IntentClassification,   // 사용자 의도 분류 → JSON { category, tool_needed, confidence }
    GreetingDetection,      // 인사 감지 → 직접 간단 응답
    HeartbeatCheck,         // "대기 중인 작업 있어?" → yes/no
    PrivacyDetection,       // 민감 데이터 패턴 감지 → 플래그
    ToolRouting,            // 어떤 도구를 호출해야 하는지 결정
    CloudDelegation,        // 대화 컨텍스트 요약 + 작업 설명 생성 → 클라우드 위임
}
```

### 2.3 라우팅 결정 로직

```rust
struct RoutingDecision {
    category: TaskCategory,      // simple | medium | complex | specialized
    tool_needed: Option<String>,  // 필요한 도구 이름 (없으면 None)
    target_llm: Target,          // local | cloud
    confidence: f64,             // 0.0 ~ 1.0
    reason: String,              // 결정 사유
}

enum TaskCategory {
    Simple,       // SLM 직접 처리 (인사, 간단 질문)
    Medium,       // 도구 호출 후 SLM이 응답 조합
    Complex,      // 클라우드 LLM 필요 (추론, 코딩, 분석)
    Specialized,  // 특수 도구 필요 (법률RAG, 음성 등)
}
```

### 2.4 클라우드 위임 프로토콜

SLM이 클라우드로 위임할 때 생성하는 데이터:

```rust
struct CloudDelegation {
    context_summary: String,       // SLM이 요약한 대화 컨텍스트
    task_description: String,      // 클라우드 모델이 수행해야 할 작업
    suggested_user_question: String, // 사용자에게 보여줄 정리된 질문
}
```

### 2.5 오프라인 동작

- SLM은 오프라인에서도 Heartbeat, 의도분류, 도구 라우팅을 수행
- 클라우드가 필요하지만 오프라인인 경우 → 작업을 로컬 큐에 저장
- 재연결 시 → 큐의 작업을 자동으로 클라우드에 디스패치

---

## 3. 멀티 프로바이더 LLM 라우팅

**파일:** `kakaomolt/src/model-router.ts`
**목적:** 6개 LLM 프로바이더에 대한 통합 라우팅, 자동 폴백, 무료/유료 티어 전환

### 3.1 지원 프로바이더

| 프로바이더 | API 엔드포인트 | 무료 티어 |
|-----------|---------------|----------|
| Anthropic (Claude) | `api.anthropic.com/v1/messages` | 없음 |
| OpenAI (GPT) | `api.openai.com/v1/chat/completions` | 없음 |
| Google (Gemini) | `generativelanguage.googleapis.com/v1beta` | 있음 (Flash) |
| Groq | `api.groq.com/openai/v1/chat/completions` | 있음 |
| Together AI | `api.together.xyz/v1/chat/completions` | 없음 |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | 있음 (`:free` 모델) |

### 3.2 라우팅 우선순위

```
1단계: 사용자 API 키가 있으면 → 해당 프로바이더 사용 (크레딧 차감 없음)
2단계: 사용자 API 키 없으면 → 플랫폼 API 키 사용 (크레딧 2배 차감)
3단계: 기본 프로바이더 실패 시 → 폴백 체인 실행
```

### 3.3 폴백 체인

```rust
// 1단계: 무료 모델 먼저 시도
let free_fallbacks = [
    ("google", "gemini-3-flash"),
    ("groq", "llama-3.3-70b-versatile"),
    ("openrouter", "google/gemini-2.0-flash-exp:free"),
];

// 2단계: 유료 모델 가성비순
let paid_fallbacks = [
    ("google", "gemini-3-flash"),
    ("google", "gemini-3-pro"),
    ("openai", "gpt-4o-mini"),
    ("anthropic", "claude-haiku-4-5"),
    ("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo"),
    ("openai", "gpt-4o"),
    ("anthropic", "claude-sonnet-4-20250514"),
    ("anthropic", "claude-opus-4-6"),
];
```

### 3.4 프로바이더별 API 호출 규격

각 프로바이더는 API 형식이 다르므로 어댑터 패턴으로 통합:

- **Anthropic**: `x-api-key` 헤더, `system` 필드 분리, `content[].type == "text"` 응답
- **OpenAI/Groq/Together/OpenRouter**: `Authorization: Bearer` 헤더, `choices[0].message.content` 응답
- **Google Gemini**: URL 파라미터 키, `contents[].parts`, `role: "model"` (assistant 대신), `systemInstruction` 별도

### 3.5 ZeroClaw 구현 시 주의점

```rust
// Rust에서는 각 프로바이더에 대한 trait을 정의
trait LlmProvider {
    async fn call(&self, messages: &[ChatMessage], max_tokens: u32) -> Result<ChatResponse>;
    fn provider_name(&self) -> &str;
    fn is_free(&self) -> bool;
}

// 그리고 각 프로바이더에 대한 구현체
struct AnthropicProvider { api_key: String }
struct OpenAIProvider { api_key: String }
struct GeminiProvider { api_key: String }
struct GroqProvider { api_key: String }
struct TogetherProvider { api_key: String }
struct OpenRouterProvider { api_key: String }
```

---

## 4. 모델 전략 시스템

**파일:** `src/skills/model-strategy.ts`
**목적:** 에이전트 역할별 최적 모델 자동 배정

### 4.1 에이전트 역할 (AgentRole)

| 역할 | 설명 | 모델 선택 기준 |
|------|------|--------------|
| `main` | 메인 에이전트 (복잡한 계획/코드) | maxPerformance 모델 |
| `sub` | 서브 에이전트 (요약/압축) | costEfficient 모델 |
| `heartbeat` | Heartbeat (주기적 상태 확인) | **항상** 로컬 SLM (비용 $0) |

### 4.2 전략 정의

```rust
enum ModelStrategy {
    CostEfficient,   // 가성비 전략
    MaxPerformance,  // 최고성능 전략
}
```

| 전략 | 메인 에이전트 (API 키 있음) | 메인 에이전트 (API 키 없음) | 서브 에이전트 | Heartbeat |
|------|--------------------------|--------------------------|-------------|-----------|
| 가성비 | 해당 프로바이더 maxPerformance | Gemini 3.0 Pro | Gemini 3.0 Flash | Qwen3 0.6B (로컬) |
| 최고성능 | 해당 프로바이더 maxPerformance | Claude Opus 4.6 | Gemini 3.0 Flash | Qwen3 0.6B (로컬) |

### 4.3 프로바이더별 모델 매핑

```rust
struct ProviderModels {
    cost_efficient: &str,
    max_performance: &str,
    display_name: &str,
}

const PROVIDER_MODELS: &[(&str, ProviderModels)] = &[
    ("anthropic", ProviderModels { cost_efficient: "claude-haiku-4-5", max_performance: "claude-opus-4-6", display_name: "Anthropic (Claude)" }),
    ("openai",    ProviderModels { cost_efficient: "gpt-4o-mini", max_performance: "gpt-5.2", display_name: "OpenAI" }),
    ("gemini",    ProviderModels { cost_efficient: "gemini-3-flash", max_performance: "gemini-3-pro", display_name: "Google Gemini" }),
    ("xai",       ProviderModels { cost_efficient: "grok-3-mini", max_performance: "grok-3", display_name: "xAI (Grok)" }),
    ("deepseek",  ProviderModels { cost_efficient: "deepseek-chat", max_performance: "deepseek-r1", display_name: "DeepSeek" }),
    ("groq",      ProviderModels { cost_efficient: "kimi-k2-0905", max_performance: "kimi-k2-0905", display_name: "Groq (Kimi K2)" }),
    ("mistral",   ProviderModels { cost_efficient: "mistral-small-latest", max_performance: "mistral-large-latest", display_name: "Mistral AI" }),
];
```

### 4.4 전략 해석 알고리즘

```
resolveModelStrategy(config, role):
  1. role == heartbeat → 항상 로컬 SLM (Qwen3 0.6B) 반환
  2. config.primaryOverride가 있으면 → 사용자 지정 모델 반환
  3. API 키 등록 프로바이더가 있으면:
     - role == main → PROVIDER_MODELS[provider].maxPerformance
     - role == sub  → PROVIDER_MODELS[provider].costEfficient
  4. API 키 없으면 (MoA 크레딧 사용):
     - role == sub  → Gemini 3.0 Flash (항상)
     - role == main:
       - 가성비 전략 → Gemini 3.0 Pro
       - 최고성능 전략 → Claude Opus 4.6
```

---

## 5. 크레딧/빌링 시스템

**파일:** `kakaomolt/src/billing.ts`
**목적:** 사용자 크레딧 관리, LLM API 사용 비용 계산 및 차감

### 5.1 빌링 규칙

| 규칙 | 설명 |
|------|------|
| 자기 API 키 사용 시 | **무료** (크레딧 차감 없음) |
| 플랫폼 API 키 사용 시 | 원가의 **2배** 크레딧 차감 |
| 200K 토큰 초과 시 | **프리미엄 요금** 자동 적용 |
| 최소 크레딧 | 1 크레딧 (올림 처리) |
| 신규 가입 시 | 무료 크레딧 제공 (기본 1,000) |

### 5.2 모델별 가격표 (KRW/1M 토큰, 2026-02 기준)

```rust
struct ModelPricing {
    input: u64,           // 기본 입력 단가 (KRW/1M tokens)
    output: u64,          // 기본 출력 단가
    premium_input: Option<u64>,  // 200K+ 장문 입력 단가
    premium_output: Option<u64>, // 200K+ 장문 출력 단가
}

const MODEL_PRICING: &[(&str, ModelPricing)] = &[
    // Claude models
    ("claude-opus-4-6",            ModelPricing { input: 7250, output: 36250, premium_input: Some(14500), premium_output: Some(54375) }),
    ("claude-sonnet-4-20250514",   ModelPricing { input: 3000, output: 15000, premium_input: None, premium_output: None }),
    ("claude-haiku-4-5",           ModelPricing { input: 800, output: 4000, premium_input: None, premium_output: None }),
    // Gemini models
    ("gemini-3-pro",               ModelPricing { input: 3625, output: 17400, premium_input: Some(5800), premium_output: Some(26100) }),
    ("gemini-3-flash",             ModelPricing { input: 218, output: 870, premium_input: None, premium_output: None }),
    // OpenAI models
    ("gpt-5.2",                    ModelPricing { input: 15000, output: 60000, premium_input: None, premium_output: None }),
    ("gpt-4o",                     ModelPricing { input: 2500, output: 10000, premium_input: None, premium_output: None }),
    ("gpt-4o-mini",                ModelPricing { input: 150, output: 600, premium_input: None, premium_output: None }),
    // Other providers
    ("grok-3",                     ModelPricing { input: 3000, output: 15000, premium_input: None, premium_output: None }),
    ("deepseek-r1",                ModelPricing { input: 550, output: 2190, premium_input: None, premium_output: None }),
    ("kimi-k2-0905",               ModelPricing { input: 200, output: 800, premium_input: None, premium_output: None }),
    // Local SLM (비용 $0)
    ("qwen3:0.6b-q4_K_M",         ModelPricing { input: 0, output: 0, premium_input: None, premium_output: None }),
];
```

### 5.3 비용 계산 알고리즘

```rust
fn calculate_cost(model: &str, input_tokens: u64, output_tokens: u64, use_platform_key: bool) -> u64 {
    let pricing = MODEL_PRICING.get(model).unwrap_or_default();
    let total_tokens = input_tokens + output_tokens;

    // 200K 토큰 초과 시 프리미엄 단가 적용
    let (input_rate, output_rate) = if total_tokens > 200_000
        && pricing.premium_input.is_some()
        && pricing.premium_output.is_some()
    {
        (pricing.premium_input.unwrap(), pricing.premium_output.unwrap())
    } else {
        (pricing.input, pricing.output)
    };

    let input_cost = (input_tokens as f64 / 1_000_000.0) * input_rate as f64;
    let output_cost = (output_tokens as f64 / 1_000_000.0) * output_rate as f64;
    let mut total_cost = input_cost + output_cost;

    // 플랫폼 키 사용 시 2배
    if use_platform_key {
        total_cost *= 2.0;
    }

    // 최소 1 크레딧, 올림
    std::cmp::max(1, total_cost.ceil() as u64)
}
```

### 5.4 API 키 암호화 저장

- 알고리즘: AES-256-CBC
- IV: 랜덤 16바이트
- 키 유도: SHA-256(환경변수 키)
- 저장 형식: `{iv_hex}:{encrypted_hex}`
- 사용자 ID 해시: SHA-256(user_id + salt) - 단방향

### 5.5 크레딧 원자적 차감

Supabase RPC 함수 `deduct_credits`를 사용하여 원자적으로 차감:

```sql
CREATE FUNCTION deduct_credits(p_kakao_user_id TEXT, p_amount INTEGER)
RETURNS TABLE(new_balance INTEGER) AS $$
  UPDATE lawcall_users
  SET credits = credits - p_amount,
      total_spent = total_spent + p_amount,
      updated_at = NOW()
  WHERE kakao_user_id = p_kakao_user_id
    AND credits >= p_amount
  RETURNING credits AS new_balance;
$$ LANGUAGE sql;
```

---

## 6. 보안 가드 시스템

**파일:** `kakaomolt/src/security-guard.ts`
**목적:** 데이터 유출 방지, 해킹 대비, 의심 패턴 감지

### 6.1 보안 위협 카테고리

```rust
enum ThreatCategory {
    DataExfiltration,    // 데이터 유출 시도
    InjectionAttack,     // 명령 주입 공격
    PrivilegeEscalation, // 권한 상승 시도
    BruteForce,          // 무차별 대입 공격
    SessionHijack,       // 세션 탈취 시도
    RemoteControl,       // 원격 조종 시도
    SocialEngineering,   // 사회공학적 공격
    DataHarvesting,      // 데이터 수집 시도
    Anomaly,             // 이상 행동
}

enum ThreatLevel { Low, Medium, High, Critical }
```

### 6.2 보호 대상 데이터 (16종)

| 데이터 유형 | 위험 등급 | 원격 전송 허용 |
|------------|----------|-------------|
| 연락처 | High | **불가** |
| 메시지/대화 | High | **불가** |
| 통화 기록 | High | **불가** |
| 위치 정보 | High | **불가** |
| 사진/이미지 | High | **불가** |
| 파일/문서 | High | **불가** |
| 일정 | Medium | 동의 시 가능 |
| 비밀번호 | **Critical** | **절대 불가** |
| 금융 정보 | **Critical** | **절대 불가** |
| 건강 정보 | **Critical** | **불가** |
| 생체 정보 | **Critical** | **절대 불가** |
| 브라우저 기록 | High | **불가** |
| 앱 데이터 | Medium | **불가** |
| 클립보드 | High | **불가** |
| 화면 내용 | **Critical** | **불가** |
| 데이터베이스 | **Critical** | **절대 불가** |

### 6.3 의심 패턴 목록 (17개)

각 패턴은 정규식으로 감지:

```rust
struct SuspiciousPattern {
    id: &str,
    name: &str,
    pattern: Regex,
    category: ThreatCategory,
    level: ThreatLevel,
}

// 주요 패턴 예시:
// 1. 연락처 유출: /(?:모든|전체)\s*(?:연락처|전화번호).*(?:보내|전송|추출)/
// 2. 메시지 유출: /(?:모든|전체|지난)\s*(?:대화|메시지).*(?:보내|전송|추출)/
// 3. 명령 주입: /[;&|`$]|\$\(|system\s*\(|exec\s*\(|eval\s*\(/
// 4. SQL 주입: /(?:union\s+select|drop\s+table|delete\s+from)/
// 5. 경로 순회: /\.\.\/|\.\.\\|%2e%2e%2f/
// 6. 권한 상승: /(?:sudo|su\s+-|chmod\s+777|root|admin)/
// 7. 원격 쉘: /(?:reverse\s*shell|bind\s*shell|nc\s+-|netcat|meterpreter)/
// 8. 비밀번호 피싱: /(?:비밀번호|패스워드).*(?:알려|말해|입력|보내)/
// 9. 금융정보 피싱: /(?:계좌|카드|은행).*(?:번호|정보).*(?:알려|말해)/
// 10. 보안 우회: /(?:보안|권한|인증).*(?:우회|무시|끄|비활성화)/
```

### 6.4 인바운드 vs 아웃바운드 구분

**핵심 설계:** 데이터를 "가져오는" 작업(인바운드)은 허용, "내보내는" 작업(아웃바운드)만 차단

```rust
fn is_inbound_operation(message: &str) -> bool {
    // 크롤링, 스크래핑, 검색, API 조회, 다운로드 등
    // → true (허용)
}

fn is_outbound_transfer(message: &str) -> bool {
    // 인바운드가 아닌 경우에만 아웃바운드 패턴 검사
    if is_inbound_operation(message) { return false; }
    // 외부 전송, 업로드, 내보내기 패턴 → true (차단)
}
```

### 6.5 이상 행동 분석

```rust
struct AnomalyResult {
    is_anomalous: bool,
    anomalies: Vec<String>,
    risk_score: u8,  // 0~100
    is_inbound_operation: bool,
}

// 분석 항목 (아웃바운드 관련만):
// 1. 비정상 시간 + 데이터 전송 시도 (+15점)
// 2. 대량 데이터 전송 시도 (>2000자 + 아웃바운드) (+25점)
// 3. 반복적 데이터 유출 시도 (3회 이상) (+35점)
// 4. Base64 인코딩 + 아웃바운드 (+45점)
// 5. 스크립트 삽입 시도 (+50점)
//
// risk_score >= 70 → 선차단
```

### 6.6 속도 제한 (Rate Limiting)

```rust
struct RateLimit {
    limit: u32,       // 기본 30회
    window_ms: u64,   // 1분 (60000ms)
}

// 초과 시 → 차단 + 보안 이벤트 로깅
```

### 6.7 세션 보안

- IP 차단 목록 관리
- 사용자 차단 목록 관리
- 실패 시도 추적: 5회 실패 → 세션 잠금 (10분 후 자동 해제)

---

## 7. 보안 미들웨어

**파일:** `kakaomolt/src/security-middleware.ts`
**목적:** "선차단 후 동의" 패턴을 구현하는 전체 보안 파이프라인

### 7.1 검사 순서

```
1. 이전 확인 응답 처리 (pending confirmation)
2. 세션 검증 (IP/사용자 차단 확인)
3. 속도 제한 확인
4. 이상 행동 분석 (risk_score >= 70이면 차단)
5. 메시지 보안 검사:
   5-1. Critical 위협 → 즉시 차단, 해제 불가
   5-2. High 위협 → 선차단, 동의 시 해제 가능
   5-3. 보호 데이터 접근 → 동의 필요
   5-4. Medium/Low 위협 → 경고만 (진행 허용)
6. 모든 검사 통과 → proceed: true
```

### 7.2 확인 요청 생성

```rust
struct PendingSecurityConfirmation {
    id: String,
    user_id: String,
    confirmation_type: ConfirmationType,  // threat_override | data_transfer | action_permission
    original_message: String,
    expires_at: DateTime,  // 3분 만료
}

// 사용자가 "본인입니다" / "동의합니다" 등으로 응답하면 해제
// 응답하지 않으면 3분 후 자동 만료 → 차단 유지
```

### 7.3 ZeroClaw 구현 포인트

```rust
// 미들웨어 결과
struct SecurityMiddlewareResult {
    proceed: bool,           // 요청 진행 가능 여부
    blocked: bool,           // 차단됨
    awaiting_consent: bool,  // 동의 대기 중
    response: Option<String>, // 사용자에게 보낼 메시지
    quick_replies: Option<Vec<String>>, // 빠른 응답 버튼
    threats: Option<Vec<ThreatInfo>>,
    required_consents: Option<Vec<ProtectedDataType>>,
    pending_confirmation_id: Option<String>,
}
```

---

## 8. 행동 권한 시스템

**파일:** `kakaomolt/src/action-permissions.ts`
**목적:** AI가 외부에 영향을 미치는 행동을 하기 전 반드시 사용자 동의를 구하는 시스템

### 8.1 행동 분류

**안전한 행동 (동의 불필요):**
- 정보 조회, 질문 답변, 검색, 계산, 번역, 요약, 설명, 길찾기

**민감한 행동 (14종, 동의 필수):**

| 행동 | 위험등급 | 매번 확인 |
|------|---------|----------|
| 이메일 발송 | High | **예** |
| SMS 발송 | High | **예** |
| 카카오톡 메시지 (타인) | High | **예** |
| 기타 메시지 전송 | Medium | **예** |
| 결제/송금 | **Critical** | **예** |
| 연락처 접근 | Medium | 아니오 |
| 캘린더 접근 | Low | 아니오 |
| 파일 접근 | Medium | 아니오 |
| 코드 실행 | High | **예** |
| 외부 API 호출 | Medium | 아니오 |
| SNS 게시 | High | **예** |
| 예약 | Medium | **예** |
| 설정 변경 | Low | 아니오 |
| 데이터 공유 | High | **예** |

### 8.2 권한 생명주기

```
1. AI가 민감한 행동 감지
2. 사용자에게 확인 요청 (5분 만료)
3. 사용자 응답:
   - "네" → 1회 허용
   - "계속 허용" → 영구 허용 (해당 카테고리)
   - "아니오" → 차단
   - 무응답 → 5분 후 자동 만료
4. 감사 로그 기록 (Supabase audit_log)
```

### 8.3 민감 행동 의도 감지

메시지에서 한국어 + 영어 패턴 매칭으로 민감 행동 의도 감지:

```rust
fn detect_sensitive_intent(message: &str) -> SensitiveIntentResult {
    // "이메일 보내줘" → send_email (confidence: high)
    // "결제해줘" → make_payment (confidence: high)
    // "카톡 보내" → send_kakao (confidence: high)
    // "예약해줘" → book_reservation (confidence: high)
}
```

---

## 9. E2E 암호화 모듈

**파일:** `kakaomolt/src/sync/encryption.ts`
**목적:** 기기 간 메모리 동기화 시 종단간 암호화

### 9.1 암호화 사양

| 항목 | 값 |
|------|-----|
| 알고리즘 | AES-256-GCM |
| 키 길이 | 256비트 (32바이트) |
| IV 길이 | 96비트 (12바이트, GCM 권장) |
| Auth Tag 길이 | 128비트 (16바이트) |
| 키 유도 | PBKDF2 (SHA-256, 100,000 이터레이션) |
| 솔트 길이 | 256비트 (32바이트) |
| 무결성 검증 | SHA-256 체크섬 |

### 9.2 데이터 구조

```rust
struct EncryptedData {
    ciphertext: String,  // Base64 인코딩
    iv: String,          // Base64 인코딩
    auth_tag: String,    // Base64 인코딩
    checksum: String,    // SHA-256 of 원문
}

struct EncryptionKey {
    key: [u8; 32],
    salt: String,  // Base64 인코딩
}
```

### 9.3 핵심 함수

```rust
// 키 유도
fn derive_key(passphrase: &str, salt: Option<&str>) -> EncryptionKey;

// 암복호화
fn encrypt(plaintext: &[u8], key: &[u8; 32]) -> EncryptedData;
fn decrypt(encrypted: &EncryptedData, key: &[u8; 32]) -> Vec<u8>;

// JSON 암복호화
fn encrypt_json<T: Serialize>(data: &T, key: &[u8; 32]) -> EncryptedData;
fn decrypt_json<T: DeserializeOwned>(encrypted: &EncryptedData, key: &[u8; 32]) -> T;

// 대용량 데이터 (gzip 압축 + 암호화)
async fn compress_and_encrypt(data: &[u8], key: &[u8; 32]) -> EncryptedData;
async fn decrypt_and_decompress(encrypted: &EncryptedData, key: &[u8; 32]) -> Vec<u8>;

// 복구 코드 (사람이 읽기 쉬운 형태)
fn key_to_recovery_code(key: &[u8; 32]) -> String;  // "XXXX-XXXX-XXXX-XXXX"
fn verify_recovery_code(key: &[u8; 32], code: &str) -> bool;
```

### 9.4 복구 코드 생성 규칙

- SHA-256(key)의 첫 16바이트 사용
- 문자셋: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (혼동 문자 제외: 0/O, 1/I/L)
- 형식: `XXXX-XXXX-XXXX-XXXX`

---

## 10. 기기 간 메모리 동기화

**파일:** `kakaomolt/src/sync/memory-sync.ts`
**목적:** Supabase Realtime을 이용한 E2E 암호화 기반 기기 간 메모리 동기화

### 10.1 동기화 원칙

1. **제로 서버 저장**: 서버는 릴레이만 담당, 데이터 영구 저장 없음
2. **E2E 암호화**: 모든 데이터는 기기에서 암호화 후 전송, 서버는 암호문만 전달
3. **Ephemeral Relay**: Supabase Realtime broadcast 사용, TTL 경과 후 자동 삭제
4. **기기 퍼스트**: 원본 데이터는 항상 사용자 기기에만 존재

### 10.2 동기화 대상 엔티티

```rust
enum SyncEntityType {
    MemoryChunk,   // 장기 기억 청크
    Conversation,  // 대화 세션
    Setting,       // 사용자 설정
}
```

### 10.3 동기화 흐름

```
기기 A                    Supabase                   기기 B
  │                        (릴레이)                     │
  ├─ 데이터 변경 ─────────────────────────────────────►│
  │  1. 로컬 변경 감지                                  │
  │  2. E2E 암호화                                      │
  │  3. 델타 생성 (type, entity, payload)               │
  │  4. Realtime broadcast ──►│                         │
  │                           │──► Realtime delivery ──►│
  │                           │                    5. 수신│
  │                           │                    6. 복호화│
  │                           │                    7. 로컬 적용│
  │                           │◄── ACK ───────────────◄─│
  │◄── ACK delivery ─────────│                         │
```

---

## 11. 동기화 재조정기

**파일:** `kakaomolt/src/sync/sync-reconciler.ts`
**목적:** Ephemeral 릴레이의 두 가지 근본 문제(누락, 순서 꼬임)를 해결

### 11.1 해결하는 문제

| 문제 | 원인 | 해결 |
|------|------|------|
| 데이터 누락 | 기기 오프라인 → TTL 경과 → 서버 삭제 | 로컬 델타 저널 보관 + 재전송 |
| 순서 꼬임 | 도착 순서 != 생성 순서 | 기기별 시퀀스 넘버 + 순서 정렬 후 적용 |

### 11.2 핵심 개념

```rust
// Version Vector: 각 기기가 다른 기기의 마지막 시퀀스를 추적
type VersionVector = HashMap<String, u64>;  // {device_id → last_seq}

// Delta Journal: 로컬에 최근 델타 보관 (기본 30일)
struct SyncDelta {
    id: String,
    source_device_id: String,
    seq: u64,                    // 단조 증가 시퀀스
    delta_type: DeltaType,       // add | update | delete
    entity_type: SyncEntityType, // memory_chunk | conversation | setting
    encrypted_payload: String,   // E2E 암호화된 페이로드
    iv: String,
    auth_tag: String,
    created_at: String,
}

enum DeltaType { Add, Update, Delete }
```

### 11.3 재연결 프로토콜

```
기기 A (재연결)              Supabase Broadcast            기기 B
    │                              │                         │
    ├── sync_request ──────────────┼────────────────────────►│
    │   {versionVector: {B: 5}}    │                    "A는 seq 5까지 받았다"
    │                              │                         │
    │                              │◄── sync_response ──────┤
    │◄─────────────────────────────┤    {deltas: [seq6, seq7, seq8]}
    │                              │                         │
    │   수신 → 시퀀스 정렬 → 적용     │                         │
    │                              │                         │
    ├── delta_ack ─────────────────┼────────────────────────►│
    │   {lastSeq: 8}               │                         │
```

### 11.4 갭 처리

```rust
fn receive_delta(delta: SyncDelta) -> ReceiveResult {
    let last_received = version_vector.get(&delta.source_device_id).unwrap_or(0);

    if delta.seq <= last_received {
        // 이미 받은 시퀀스 → 무시 (idempotent)
        return ReceiveResult::Duplicate;
    }

    if delta.seq == last_received + 1 {
        // 순서 맞음 → 즉시 적용 + 버퍼 flush
        apply_delta(delta);
        flush_buffer(delta.source_device_id);
        return ReceiveResult::Applied;
    }

    // 갭 발생 → 버퍼에 넣고 빠진 시퀀스 요청
    buffer_delta(delta);
    request_missing_deltas();
    return ReceiveResult::Buffered;
}
```

### 11.5 수동 전체 동기화

30일 이상 오프라인이었던 기기를 위한 수동 동기화:

```
1. 내 매니페스트(엔티티 ID 목록) 생성 → broadcast
2. 상대 기기가 자기 매니페스트 응답
3. 양측이 서로 비교 → 빠진 엔티티를 broadcast로 전송
4. 수신 측이 로컬에 저장
5. 60초 타임아웃 (상대 기기가 없으면)
```

### 11.6 Broadcast 메시지 타입

```rust
enum BroadcastMessage {
    SyncRequest { from_device_id: String, version_vector: VersionVector },
    SyncResponse { from_device_id: String, deltas: Vec<SyncDelta> },
    DeltaAck { from_device_id: String, source_device_id: String, last_seq: u64 },
    FullSyncRequest { from_device_id: String, manifest: FullSyncManifest },
    FullSyncManifestResponse { from_device_id: String, manifest: FullSyncManifest },
    FullSyncData { from_device_id: String, entity_type: String, entity_id: String, encrypted_payload: String, iv: String, auth_tag: String },
    FullSyncComplete { from_device_id: String, sent_count: u64 },
}
```

### 11.7 상태 저장/복원

앱 종료 시 상태를 로컬 스토리지에 저장, 재시작 시 복원:

```rust
struct ReconcilerState {
    local_seq: u64,
    version_vector: VersionVector,
    journal: Vec<SyncDelta>,
    exported_at: String,
}
```

---

## 12. 실시간 음성 통역 시스템

**파일:** `kakaomolt/src/voice/realtime-interpreter.ts`
**목적:** Gemini 2.5 Flash Native Audio를 이용한 실시간 음성-음성 통역

### 12.1 지원 언어 (25개)

| 지역 | 언어 |
|------|------|
| 동아시아 | 한국어(ko), 일본어(ja), 중국어 간체(zh), 중국어 번체(zh-TW) |
| 동남아시아 | 태국어(th), 베트남어(vi), 인도네시아어(id), 말레이어(ms), 필리핀어(tl) |
| 남아시아 | 힌디어(hi) |
| 유럽 | 영어(en), 스페인어(es), 프랑스어(fr), 독일어(de), 이탈리아어(it), 포르투갈어(pt), 네덜란드어(nl), 폴란드어(pl), 체코어(cs), 스웨덴어(sv), 덴마크어(da) |
| 동유럽 | 러시아어(ru), 우크라이나어(uk), 터키어(tr) |
| 중동 | 아랍어(ar) |

### 12.2 기능

- 실시간 음성-음성 통역 (< 500ms 지연)
- 양방향 모드 (A↔B 언어 자동 전환)
- 텍스트 번역 폴백
- 대화 컨텍스트 유지
- 격식 수준 조절 (formal / neutral / casual)
- 도메인 특화 (general / business / medical / legal / technical)
- 톤 보존 (감정/강조 유지)

### 12.3 통역 세션 구조

```rust
struct InterpreterConfig {
    source_language: LanguageCode,
    target_language: LanguageCode,
    bidirectional: bool,           // 양방향 자동 전환
    formality: Formality,          // formal | neutral | casual
    domain: Option<Domain>,        // general | business | medical | legal | technical
    preserve_tone: bool,           // 톤/감정 보존
    api_key: Option<String>,
}

struct InterpreterSession {
    id: String,
    user_id: String,
    config: InterpreterConfig,
    status: InterpreterStatus,    // idle | connecting | ready | listening | interpreting | speaking | error | closed
    stats: InterpreterStats,
}

struct InterpreterStats {
    utterance_count: u64,
    total_duration_ms: u64,
    avg_latency_ms: f64,
    source_words: u64,
    target_words: u64,
}
```

### 12.4 언어 자동 감지

유니코드 범위로 입력 언어 자동 감지:

```rust
fn detect_language(text: &str) -> LanguageCode {
    if contains_hangul(text) { return LanguageCode::Ko; }       // U+AC00-U+D7AF
    if contains_kana(text) { return LanguageCode::Ja; }         // U+3040-U+30FF
    if contains_cjk_only(text) { return LanguageCode::Zh; }    // U+4E00-U+9FFF (no kana)
    if contains_arabic(text) { return LanguageCode::Ar; }       // U+0600-U+06FF
    if contains_thai(text) { return LanguageCode::Th; }         // U+0E00-U+0E7F
    if contains_cyrillic(text) { return LanguageCode::Ru; }     // U+0400-U+04FF
    // default: source or English
}
```

### 12.5 Gemini Live API 통합

- 모델: `gemini-2.5-flash-preview-native-audio-dialog`
- VAD (Voice Activity Detection): 임계값 0.4
- 침묵 감지: 300ms (빠른 턴 교대)
- 언어별 최적화된 음성 이름 (Kore, Puck, Aoede, Charon, Fenrir)

---

## 13. 의도 분류기

**파일:** `kakaomolt/src/intent-classifier.ts`
**목적:** 사용자 메시지를 분석하여 적절한 처리 방식 결정

### 13.1 의도 유형 (15종)

| 의도 | 우선순위 | 처리 방식 |
|------|---------|----------|
| `billing` | 100 | 빌링 핸들러 |
| `creative_image` | 90 | 이미지 생성 AI |
| `creative_emoticon` | 90 | 이모티콘 생성 |
| `creative_music` | 90 | 음악 생성 |
| `creative_qrcode` | 90 | QR 코드 생성 |
| `weather` | 80 | 날씨 도구 |
| `calendar` | 80 | 일정 도구 |
| `sports` | 80 | 스포츠 도구 |
| `public_data` | 75 | 공공 데이터 API |
| `legal_consult` | 70 | 외부 법률 상담 서비스 |
| `medical_consult` | 70 | 외부 의료 상담 |
| `tax_consult` | 70 | 외부 세무 상담 |
| `legal_info` | 65 | Legal RAG |
| `web_search` | 50 | AI 검색 (Perplexity/Google) |
| `chat` | 0 | LLM 직접 응답 |

### 13.2 패턴 매칭 구조

```rust
struct IntentPattern {
    intent_type: IntentType,
    patterns: Vec<Regex>,
    priority: u8,
    extractors: Option<Vec<EntityExtractor>>,  // 엔티티 추출기
}

struct EntityExtractor {
    name: String,
    pattern: Regex,
}

struct ClassifiedIntent {
    intent_type: IntentType,
    confidence: f64,                    // 0.0 ~ 1.0
    entities: HashMap<String, String>,  // 추출된 엔티티 (location, date, team 등)
    requires_external_service: bool,
    external_service_url: Option<String>,
}
```

### 13.3 엔티티 추출 예시

- **날씨**: 위치 (서울, 부산, ...), 날짜 (오늘, 내일, ...)
- **스포츠**: 종목 (야구, 축구, ...), 리그 (KBO, K리그, ...), 팀 (두산, LG, ...)
- **일정**: 날짜 (오늘, 내일, M월 D일)

### 13.4 복합 의도 감지

하나의 메시지에 여러 의도가 섞여 있으면 문장 단위로 분리하여 각각 분류:

```rust
fn detect_multiple_intents(message: &str) -> Vec<ClassifiedIntent> {
    let sentences = message.split(&['.', '?', '!']);
    // 각 문장별 의도 분류 → 중복 제거 → 반환
}
```

---

## 14. KakaoTalk 채널 통합

**파일:** `kakaomolt/src/channel.ts`, `kakaomolt/src/webhook.ts`
**목적:** KakaoTalk을 OpenClaw 채널 플러그인으로 통합

### 14.1 채널 플러그인 구조

OpenClaw의 `ChannelPlugin` 인터페이스를 구현:

```rust
struct KakaoChannelPlugin {
    id: "kakao",
    capabilities: ChannelCapabilities {
        chat_types: ["direct"],
        reactions: false,
        threads: false,
        media: true,
        native_commands: false,
        block_streaming: true,  // KakaoTalk은 전체 응답 필요 (스트리밍 불가)
    },
}
```

### 14.2 웹훅 서버

- HTTP 서버: Node.js `http.createServer`
- 포트: 8788 (기본값)
- 경로: `/kakao/webhook`
- 헬스체크: `GET /health`
- 입력: Kakao i Open Builder 스킬 서버 요청
- 출력: KakaoSkillResponse (simpleText, listCard, quickReplies)

### 14.3 보안 정책

| 정책 | 옵션 |
|------|------|
| DM 정책 | `open`, `allowlist`, `disabled` |
| 허용 목록 | 특정 사용자 ID만 허용 가능 |
| 설정 검증 | 계정 설정 유효성 자동 검증 |

### 14.4 웹훅 요청 처리 흐름

```
POST /kakao/webhook
  │
  ├─ JSON 파싱 → KakaoIncomingMessage
  ├─ userId, text, botId, blockId 추출
  ├─ 특수 명령 확인:
  │   ├─ 동기화 명령 (sync) → handleSyncCommand
  │   ├─ 빌링 명령 (잔액, 충전, API키) → handleBillingCommand
  │   ├─ 브릿지 명령 (MoltBot) → parseBridgeCommand
  │   └─ 법률 질문 → getConsultationButton
  ├─ preBillingCheck (크레딧 확인)
  ├─ onMessage (일반 메시지 핸들러)
  ├─ postBillingDeduct (크레딧 차감)
  └─ 응답: KakaoSkillResponse
```

---

## 15. MoltBot 에이전트 브릿지

**파일:** `kakaomolt/src/moltbot/` 디렉터리
**목적:** OpenClaw 에이전트 프레임워크와 KakaoTalk 채널을 연결

### 15.1 구성 모듈

| 파일 | 역할 |
|------|------|
| `agent-integration.ts` | OpenClaw 에이전트와 KakaoTalk 통합 |
| `channel-bridge.ts` | 채널 간 메시지 브릿지 |
| `gateway-client.ts` | OpenClaw 게이트웨이 API 클라이언트 |
| `memory-adapter.ts` | OpenClaw 메모리 시스템 어댑터 |
| `tool-bridge.ts` | OpenClaw 도구를 KakaoTalk에서 사용 가능하게 브릿지 |

### 15.2 통합 포인트

```rust
trait MoltbotAgentIntegration {
    // 도구 목록 조회
    fn format_tool_list(&self) -> String;
    // 채널 목록 조회
    fn format_channel_list(&self) -> String;
    // 브릿지 명령 파싱
    fn parse_bridge_command(&self, message: &str) -> Option<BridgeCommand>;
}
```

---

## 16. 도구 디스패처 시스템

**파일:** `kakaomolt/src/tool-dispatcher.ts`, `kakaomolt/src/tools/`
**목적:** 의도 분류 결과에 따라 적절한 도구를 호출

### 16.1 도구 목록

| 도구 | 파일 | 데이터 소스 |
|------|------|-----------|
| 날씨 조회 | `tools/weather.ts` | 기상청 API |
| 웹 검색 | `tools/search.ts` | Perplexity / Google Search |
| 일정 관리 | `tools/calendar.ts` | Kakao 톡캘린더 |
| 스포츠 정보 | `tools/sports.ts` | 스포츠 API |
| 공공 데이터 | `tools/public-data.ts` | 공공데이터포털 |
| 네비게이션 | `tools/navigation.ts` | Kakao Map |
| 창작 (이미지/음악) | `tools/creative.ts` | DALL-E / Suno |

### 16.2 도구 호출 흐름

```
의도분류 결과
    │
    ▼
[도구 디스패처]
    │
    ├─ intent.type == "weather" → weatherTool.execute(entities)
    ├─ intent.type == "calendar" → calendarTool.execute(entities)
    ├─ intent.type == "sports" → sportsTool.execute(entities)
    ├─ intent.type == "web_search" → searchTool.execute(message)
    ├─ intent.type == "creative_image" → creativeTool.generateImage(prompt)
    ├─ intent.type == "creative_music" → creativeTool.generateMusic(prompt)
    ├─ intent.type == "legal_info" → legalRag.query(message)
    └─ intent.type == "chat" → LLM 직접 응답
```

---

## 17. RAG (법률 정보 검색)

**파일:** `kakaomolt/src/rag/legal-rag.ts`
**목적:** 법률 정보에 대한 Retrieval-Augmented Generation

### 17.1 법률 상담 라우팅

| 유형 | 처리 |
|------|------|
| 일반 법률 정보 (법령, 조문, 판례) | Legal RAG로 검색 + LLM 응답 |
| 전문 법률 상담 (고소, 재판 등) | 외부 서비스 연결 (LawCall) |

### 17.2 법률 질문 감지

```rust
fn is_legal_question(message: &str) -> bool {
    // "법률", "법령", "조문", "판례", "손해배상", "계약", "이혼", "상속" 등
    // 패턴 매칭
}
```

### 17.3 면책 조항

법률 정보 응답 시 반드시 포함: "이것은 법률 정보이며 법률 조언이 아닙니다"

---

## 18. 오프라인 큐 및 복구 시스템

**파일:** `src/slm/slm-router.ts` (큐 관리 부분)
**목적:** 오프라인 시 클라우드 작업을 로컬에 큐잉, 재연결 시 자동 처리

### 18.1 큐 저장

```rust
// 저장 경로: ~/.moa/offline-queue.json
struct QueuedCloudTask {
    id: String,
    user_message: String,
    context_summary: String,     // SLM이 요약한 컨텍스트
    task_description: String,
    queued_at: String,
    strategy: CloudStrategy,
    duplicate_count: u64,        // 중복 병합 횟수
}
```

### 18.2 중복 제거

동일 `userMessage + taskDescription` → 기존 항목의 `duplicate_count` 증가, 새 엔트리 생성 안 함

### 18.3 복구 흐름

```
1. 네트워크 복구 감지 (OfflineMonitor)
2. 오프라인 큐 로드
3. 각 작업에 대해:
   a. 클라우드 디스패처로 위임
   b. 성공 시 큐에서 제거
   c. 실패 시 재시도 (지수 백오프)
4. 사용자에게 처리 결과 알림
```

---

## 19. 클라우드 디스패처

**파일:** `src/slm/cloud-dispatcher.ts`
**목적:** SLM이 생성한 위임 정보를 클라우드 모델에 전달하기 위한 파일 기반 프로토콜

### 19.1 위임 파일

```rust
struct DelegationFile {
    context_summary: String,
    task_description: String,
    suggested_user_question: String,
    strategy: CloudStrategy,     // cost_effective | max_performance
    created_at: String,
}

// 저장 경로: ~/.moa/delegation-{timestamp}.json
```

---

## 20. Ollama 자동 설치기

**파일:** `src/slm/ollama-installer.ts`
**목적:** SLM 실행에 필요한 Ollama + 모델을 자동 설치

### 20.1 설치 순서

```
1. Ollama 설치 확인 (ollama --version)
2. 미설치 시:
   - macOS: brew install ollama
   - Linux: curl -fsSL https://ollama.ai/install.sh | sh
3. Ollama 서버 시작 (ollama serve)
4. 코어 모델 다운로드 (ollama pull qwen3:0.6b-q4_K_M)
5. 모델 상태 확인 (ollama list)
6. 자동 복구 (문제 발생 시 재설치)
```

### 20.2 클라우드 모델 설정

```rust
enum CloudStrategy {
    CostEffective,   // Gemini 3.0 Flash
    MaxPerformance,  // Claude Opus 4.6
}

struct CloudModel {
    provider: &str,
    model: &str,
    display_name: &str,
}
```

---

## 21. 음성 처리 파이프라인

**파일:** `kakaomolt/src/voice/` 디렉터리
**목적:** 실시간 음성 입출력 처리

### 21.1 프로바이더 구조

```rust
trait VoiceProvider {
    async fn connect(&self, user_id: &str);
    fn send_audio(&self, chunk: &[u8]);
    fn send_text(&self, text: &str);
    async fn disconnect(&self);
}
```

| 프로바이더 | API | 용도 |
|-----------|-----|------|
| Gemini Live | `gemini-2.5-flash-preview-native-audio-dialog` | 실시간 통역, 음성 대화 |
| OpenAI Realtime | `gpt-4o-realtime-preview` | 음성 대화 (폴백) |

### 21.2 음성 빌링

음성 세션별 과금: 초당 토큰 환산하여 크레딧 차감

---

## 22. 결제 시스템

**파일:** `kakaomolt/src/payment.ts`
**목적:** Kakao Pay를 통한 크레딧 충전

### 22.1 충전 플로우

```
1. 사용자: "충전"
2. 충전 금액 선택 (1000, 3000, 5000, 10000원)
3. Kakao Pay 결제 링크 생성
4. 사용자가 결제 완료
5. 웹훅으로 결제 확인
6. 크레딧 추가 (원자적 연산)
7. 충전 완료 알림
```

---

## 23. Supabase 통합

**파일:** `kakaomolt/src/supabase.ts`
**목적:** 사용자 데이터, 빌링, 보안 이벤트 저장을 위한 Supabase 연동

### 23.1 환경변수

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

### 23.2 사용하는 Supabase 기능

| 기능 | 용도 |
|------|------|
| PostgreSQL (Tables) | 사용자, 빌링, 권한, 감사 로그 |
| RPC Functions | 원자적 크레딧 차감/추가 |
| Realtime Broadcast | E2E 암호화 메모리 동기화 |
| Row Level Security | 데이터 접근 제어 |

---

## 24. 데이터베이스 스키마

### 24.1 테이블 목록

```sql
-- 사용자 계정
CREATE TABLE lawcall_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kakao_user_id TEXT UNIQUE NOT NULL,  -- SHA-256 해시
    credits INTEGER DEFAULT 1000,
    total_spent INTEGER DEFAULT 0,
    custom_api_key TEXT,                  -- AES-256-CBC 암호화
    custom_provider TEXT,                 -- "anthropic" | "openai"
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 사용 기록
CREATE TABLE lawcall_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES lawcall_users(id),
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    credits_used INTEGER NOT NULL,
    used_platform_key BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 사용자 권한
CREATE TABLE user_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kakao_user_id TEXT UNIQUE NOT NULL,
    permissions JSONB DEFAULT '[]',
    global_consent BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 감사 로그
CREATE TABLE action_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    result TEXT DEFAULT 'success',  -- success | blocked | pending
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 보안 이벤트
CREATE TABLE security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    severity TEXT DEFAULT 'info',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 24.2 RPC 함수

```sql
-- 원자적 크레딧 차감
CREATE FUNCTION deduct_credits(p_kakao_user_id TEXT, p_amount INTEGER)
RETURNS TABLE(new_balance INTEGER) AS $$
  UPDATE lawcall_users
  SET credits = credits - p_amount,
      total_spent = total_spent + p_amount,
      updated_at = NOW()
  WHERE kakao_user_id = p_kakao_user_id
    AND credits >= p_amount
  RETURNING credits AS new_balance;
$$ LANGUAGE sql;

-- 원자적 크레딧 추가
CREATE FUNCTION add_credits(p_kakao_user_id TEXT, p_amount INTEGER)
RETURNS TABLE(new_balance INTEGER) AS $$
  UPDATE lawcall_users
  SET credits = credits + p_amount,
      updated_at = NOW()
  WHERE kakao_user_id = p_kakao_user_id
  RETURNING credits AS new_balance;
$$ LANGUAGE sql;
```

---

## 부록 A: ZeroClaw 마이그레이션 체크리스트

### 필수 구현 순서 (의존성 기반)

```
Phase 1 - 기반:
  [ ] E2E 암호화 모듈 (AES-256-GCM, PBKDF2)
  [ ] Supabase 클라이언트
  [ ] 데이터베이스 스키마 생성
  [ ] 사용자 설정 관리 (해시, 암호화)

Phase 2 - 보안:
  [ ] 보안 가드 (위협 감지, 패턴 매칭)
  [ ] 보안 미들웨어 (선차단 후 동의)
  [ ] 행동 권한 시스템
  [ ] 속도 제한
  [ ] 세션 관리

Phase 3 - AI 라우팅:
  [ ] SLM 로컬 게이트키퍼 (Ollama + Qwen3)
  [ ] 멀티 프로바이더 LLM 라우팅
  [ ] 모델 전략 시스템
  [ ] 클라우드 디스패처
  [ ] 오프라인 큐

Phase 4 - 빌링:
  [ ] 크레딧/빌링 시스템
  [ ] 모델별 가격표
  [ ] 원자적 크레딧 차감
  [ ] 결제 연동 (Kakao Pay)

Phase 5 - 동기화:
  [ ] 메모리 동기화 엔진
  [ ] 동기화 재조정기 (Version Vector, Delta Journal)
  [ ] 수동 전체 동기화
  [ ] 상태 저장/복원

Phase 6 - 채널:
  [ ] KakaoTalk 웹훅 서버
  [ ] 채널 플러그인
  [ ] MoltBot 에이전트 브릿지

Phase 7 - 도구:
  [ ] 의도 분류기
  [ ] 도구 디스패처
  [ ] 각 도구 구현 (날씨, 검색, 일정, 스포츠, 창작 등)
  [ ] Legal RAG

Phase 8 - 음성:
  [ ] 음성 프로바이더 (Gemini Live, OpenAI Realtime)
  [ ] 실시간 통역 시스템
  [ ] 음성 빌링
```

### Rust 특화 고려사항

| TypeScript 패턴 | Rust 대안 |
|----------------|----------|
| `Map<string, T>` | `HashMap<String, T>` |
| `Promise<T>` | `async fn -> Result<T>` (tokio) |
| `EventEmitter` | `tokio::sync::broadcast` 또는 `tokio::sync::mpsc` |
| `setTimeout` | `tokio::time::sleep` |
| `RegExp` | `regex` crate |
| `fetch` | `reqwest` crate |
| `crypto` | `aes-gcm`, `pbkdf2`, `sha2` crates |
| `zlib` | `flate2` crate |
| Supabase JS SDK | `postgrest-rs` + `realtime-rs` 또는 직접 HTTP |
| JSON 직렬화 | `serde` + `serde_json` |
| WebSocket | `tokio-tungstenite` |

---

## 부록 B: 환경변수 목록

```bash
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# LLM API Keys (플랫폼)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
TOGETHER_API_KEY=
OPENROUTER_API_KEY=

# 빌링/보안
LAWCALL_ENCRYPTION_KEY=    # API 키 암호화용
LAWCALL_USER_SALT=         # 사용자 ID 해시 솔트
LAWCALL_FREE_CREDITS=1000  # 신규 가입 무료 크레딧

# KakaoTalk
KAKAO_REST_API_KEY=
KAKAO_ADMIN_KEY=

# 외부 서비스
LAWCALL_DEFAULT_URL=       # 법률 상담 서비스 URL
```

---

## 25. 2-Tier 로컬 SLM (모바일 확장)

**파일:** `extensions/kakao/src/slm/`
**목적:** 모바일 환경에서 오프라인 성능 향상을 위한 2단계 로컬 모델

### 25.1 아키텍처

Kakao 확장에서는 기본 SLM(0.6B) 외에 더 큰 로컬 모델(4B)을 추가하여 2-Tier 로컬 처리:

```
Tier 1: Qwen3-0.6B (항상 실행)
  → 빠른 의도 분류, 간단 응답, Heartbeat
  → ~400MB, 응답 < 100ms

Tier 2: Qwen3-4B (온디맨드 로드)
  → 오프라인에서 심층 추론, 복잡한 질문 처리
  → ~2.5GB, 응답 < 2s

Tier 3: Cloud (온라인 시)
  → 최고 품질 응답
```

### 25.2 차이점 (기본 vs 모바일)

| 항목 | 기본 (src/slm) | 모바일 (extensions/kakao/src/slm) |
|------|--------------|--------------------------------|
| Tier 1 | Qwen3-0.6B | Qwen3-0.6B |
| Tier 2 | **없음** (바로 클라우드) | Qwen3-4B (오프라인 추론) |
| Tier 3 | 클라우드 | 클라우드 |
| 오프라인 능력 | 의도분류만 | 의도분류 + 심층 추론 |

---

## 26. 모델 자동 선택 (퍼지 매칭)

**파일:** `src/auto-reply/reply/model-selection.ts`
**목적:** 사용자가 모델명을 부정확하게 입력해도 가장 적합한 모델 자동 매칭

### 26.1 매칭 알고리즘

레벤슈타인 거리 기반 퍼지 매칭 (최대 거리 3):

```rust
struct ModelMatchScore {
    model_id: String,
    score: u32,
}

// 점수 체계:
// 정확한 매칭: 220점
// 프래그먼트로 시작: 140점
// 프래그먼트 포함: 110점
// 별칭 정확 매칭: 140점 (예: "claude" → "anthropic/claude-opus-4-6")
// 시스템 기본 모델 보너스: +20점
// 변형 토큰 패널티: -점수 (mini, flash 등 불일치 접미사)
```

### 26.2 모델 허용 목록

에이전트별 허용 목록 설정 가능:

```rust
// agents.defaults.models에서 허용된 모델만 선택 가능
// 허용 목록에 없는 모델은 매칭 불가
// 스레드 내에서는 부모 세션의 모델 상속
```

---

## 27. 모델 폴백 체인

**파일:** `src/agents/model-fallback.ts`
**목적:** 프라이머리 모델 실패 시 자동으로 폴백 모델 시도

### 27.1 폴백 순서

```
1. 프라이머리 모델 (사용자 선택)
   ↓ (실패 시)
2. 설정된 폴백 목록 (agents.defaults.model.fallbacks)
   ↓ (모두 실패 시)
3. 시스템 기본 모델 (Claude Opus 4.5)
   ↓ (실패 시)
4. 에러 반환 (시도 로그 포함)
```

### 27.2 쿨다운 관리

프로바이더별 속도 제한 감지 시 쿨다운:

```rust
struct AuthProfile {
    provider: String,
    api_key: String,
    cooldown_until: Option<DateTime>,
    failure_count: u32,
}

// 라운드 로빈 프로필 회전: 하나가 쿨다운이면 다음 프로필 시도
```

---

## 28. 웹 앱 크레딧 시스템

**파일:** `apps/web/src/lib/credits.ts`
**목적:** 웹 앱에서의 모델별 크레딧 비용 및 플랜 관리

### 28.1 모델별 크레딧 비용 (1회 요청)

| 티어 | 모델 | 크레딧 |
|------|------|--------|
| **무료** | Groq Kimi K2, Groq Llama 3.3 | 0 |
| **저가** | Gemini Flash, GPT-4o Mini, DeepSeek Chat | 1~2 |
| **중가** | Claude Haiku 4.5, Grok-3 Mini, Gemini Pro | 4~8 |
| **고가** | GPT-4o, Grok-3, Claude Sonnet | 8~22 |
| **프리미엄** | GPT-5, Claude Opus 4.6 | 25~100 |

### 28.2 구독 플랜

| 플랜 | 월 크레딧 | 가격 |
|------|----------|------|
| Free | 100 | 무료 |
| Basic | 3,000 | - |
| Pro | 15,000 | - |

### 28.3 크레딧 충전 패키지 (KRW)

| 패키지 | 크레딧 | 보너스 | 가격 |
|--------|--------|--------|------|
| Basic | 5,000 | 0 | 5,000원 |
| Standard | 10,000 | +2,000 | 10,000원 |
| Premium | 20,000 | +10,000 | 20,000원 |
| Pro | 50,000 | +10,000 | 50,000원 |

---

## 29. SLM Thinking 모드 제어

**파일:** `src/slm/slm-router.ts`
**목적:** 모델별 추론(thinking) 깊이 제어

### 29.1 Thinking 레벨

```rust
enum ThinkingLevel {
    Off,      // 추론 없음
    Minimal,  // 최소 추론
    Low,      // 낮은 추론
    Medium,   // 보통 추론
    High,     // 깊은 추론
    XHigh,    // 최대 추론
}
```

### 29.2 모델별 Thinking 지원

| 모델 | Thinking 지원 |
|------|-------------|
| Claude (Anthropic) | 전체 지원 (budget 토큰 설정 가능) |
| Gemini (Google) | Extended thinking 지원 |
| Qwen3 (로컬 SLM) | `/no_think` 플래그로 비활성화 |
| Legacy 모델 | 미지원 |

### 29.3 SLM 프롬프트별 Temperature

| 프롬프트 | Temperature | 비고 |
|---------|------------|------|
| 라우팅 (의도분류) | **0.1** | 결정적 |
| 간단 응답 | **0.7** | 균형 |
| Heartbeat | **0.1** | 결정적 |
| 위임 준비 | **0.1** | 결정적 |

---

## 30. 디바이스 바인딩 암호화

**파일:** `extensions/kakao/src/security/device-security.ts`
**목적:** 기기별 데이터베이스 암호화 및 기기 바인딩

### 25.1 디바이스 바인딩 암호화

기기에 물리적으로 묶인 암호화 키를 생성하여, DB 파일을 다른 기기로 복사해도 열 수 없게 함:

```rust
struct DeviceFingerprint {
    device_id: String,       // Android ID / iOS identifierForVendor
    os_info: String,         // iOS/Android 버전
    model_hash: String,      // 기기 모델 식별자 해시
    installation_id: String, // 앱 재설치 시 변경 (추가 보호)
}

// 키 유도: PBKDF2(device_fingerprint + user_passphrase, salt, 200,000 iterations)
// → AES-256-GCM 키
```

| 항목 | 값 |
|------|-----|
| 알고리즘 | AES-256-GCM |
| PBKDF2 이터레이션 | **200,000** (일반 동기화의 2배) |
| 2팩터 키 유도 | 디바이스 지문 + 사용자 패스프레이즈 |
| 파일 형식 | `[4B IV길이][IV][ciphertext][auth_tag]` |
| 파일 확장자 | `.moa-encrypted` |

### 25.2 보안 삭제 (Secure Overwrite)

파일 삭제 시 3-pass 덮어쓰기 후 unlink:

```rust
fn secure_delete(path: &Path) -> Result<()> {
    let size = fs::metadata(path)?.len();
    let mut file = File::open(path)?;
    // Pass 1: 모든 0x00
    file.write_all(&vec![0x00; size as usize])?;
    file.sync_all()?;
    // Pass 2: 모든 0xFF
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&vec![0xFF; size as usize])?;
    file.sync_all()?;
    // Pass 3: 랜덤 데이터
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&random_bytes(size as usize))?;
    file.sync_all()?;
    // 파일 삭제
    fs::remove_file(path)?;
    Ok(())
}
```

---

## 31. 원격 잠금/삭제 (Remote Wipe)

**파일:** `extensions/kakao/src/security/remote-wipe.ts`
**목적:** 기기 분실/도난 시 원격으로 데이터 삭제

### 26.1 삭제 전략

```rust
enum WipeStrategy {
    Immediate,        // 백업이 최신이면 → 즉시 삭제
    BackupThenWipe,   // 백업 없거나 오래됨 → 긴급 백업 후 삭제
}

// 자동 판단:
// - 최근 백업 존재 + 최신 → Immediate
// - 백업 없거나 오래됨 → BackupThenWipe (최대 3회 재시도, 2초 간격)
```

### 26.2 삭제 범위

```rust
enum WipeScope {
    All,           // 모든 데이터
    MemoryDb,      // 메모리 DB만
    ChatHistory,   // 대화 기록만
    Credentials,   // 인증 정보만
}
```

### 26.3 토큰 즉시 무효화

삭제 요청 시 해당 기기의 디바이스 토큰을 즉시 무효화:
- 기존 토큰 → 내부 전용 "wipe-only" 토큰 (7일 TTL)으로 교체
- 도난자가 릴레이에 접근하는 것을 즉시 차단

### 26.4 실행 흐름

```
사용자: /분실신고 (다른 기기에서)
  → DB에서 백업 상태 확인
  → 전략 결정 (Immediate or BackupThenWipe)
  → 토큰 즉시 무효화
  → 분실 기기의 Heartbeat에서 wipe 명령 감지
  → 전략에 따라 실행 (백업 → 3-pass 삭제)
  → 토큰 정리
```

---

## 32. 분실 기기 위치 추적

**파일:** `extensions/kakao/src/security/device-location-tracker.ts`
**목적:** 분실/도난 기기의 GPS 위치를 추적

### 27.1 추적 설정

| 항목 | 값 |
|------|-----|
| 기본 추적 간격 | 30초 (고정밀 모드) |
| 배터리 절약 모드 | 60초 (2배) |
| 기본 만료 | 72시간 (3일) |
| 데이터 보관 | 30일 후 자동 삭제 |

### 27.2 수집 데이터

```rust
struct LocationData {
    latitude: f64,
    longitude: f64,
    accuracy: f64,           // 미터
    altitude: Option<f64>,
    speed: Option<f64>,
    bearing: Option<f64>,
    battery_level: Option<u8>,
    network_type: NetworkType, // WiFi | Cellular | None
    is_moving: bool,
}
```

### 27.3 중요 설계 결정

**삭제 후에도 GPS 추적 계속**: 원격 삭제가 MoA 데이터만 삭제하고, 기기의 다른 데이터(SMS, 카카오톡, 사진, 이메일 등)는 그대로 남아있으므로, 기기 회수를 위해 GPS 추적은 `/추적종료` 명령 또는 72시간 만료까지 계속됨.

### 27.4 이동 거리 계산

Haversine 공식으로 두 좌표 간 거리 계산:

```rust
fn haversine_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let r = 6371000.0; // 지구 반지름 (미터)
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();
    let a = (d_lat/2.0).sin().powi(2) +
            lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon/2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0-a).sqrt());
    r * c
}
```

---

## 33. 대화 기록 보호 (Chat History Guard)

**파일:** `extensions/kakao/src/security/chat-history-guard.ts`
**목적:** 대화 기록의 자동 삭제, 데이터 마스킹, 분실 잠금

### 28.1 휘발성 메시지 (Ephemeral Messages)

| 항목 | 값 |
|------|-----|
| 기본 TTL | 5분 (300초) |
| 삭제 방법 | 채널별 API 사용 (Telegram: deleteMessage, Discord: bulkDelete) |
| 스케줄링 | Supabase에 삭제 일정 저장 |

### 28.2 자동 데이터 마스킹 (44+ 패턴)

LLM에는 원문을 전달하지만, **저장/전송 시에는 마스킹** 적용:

```rust
// 마스킹 패턴 목록:
// 신분증: 주민등록번호, 운전면허, 여권, 외국인등록번호
// 금융: 신용카드 (****-****-****-****), 계좌 (***-****-****), CVV/CVC
// 인증: 비밀번호 ([비밀번호 보호됨]), PIN, OTP, 공인인증서
// API키: OpenAI (sk-*), AWS (AKIA*), Bearer 토큰
// 연락처: 전화번호 (010-****-****), 이메일 (***@***.***), 주소

struct MaskingResult {
    original: String,     // LLM 전달용 (원문)
    masked: String,       // 저장/전송용 (마스킹)
    detected_types: Vec<SensitiveDataType>,
}
```

### 28.3 분실 잠금 모드 (Lockdown)

| 명령 | 동작 |
|------|------|
| `/분실신고` | 잠금 모드 활성화 → 모든 MoA 응답 차단 |
| 응답 | "이 기기는 분실 신고되었습니다" |
| `/분실취소` | 재인증 후 잠금 해제 |

---

## 34. 암호화 백업 볼트 (Encrypted Vault)

**파일:** `extensions/kakao/src/safety/encrypted-vault.ts`
**목적:** Time Machine 방식의 자동 회전 암호화 백업

### 29.1 백업 보관 정책

| 기간 | 보관 수 |
|------|--------|
| 일별 | 최근 7일 |
| 주별 | 최근 4주 |
| 월별 | 최근 12개월 |
| **최대** | **23개 백업 파일** |

### 29.2 복구 키 (Recovery Key)

```rust
// 12단어 한국어 니모닉 (256개 단어 사전에서 선택)
// 자연 테마: 나무, 동물, 꽃 + 추상 개념
// 예: "소나무 호랑이 벚꽃 하늘 바다 구름 ..."

fn generate_recovery_key() -> Vec<String> {
    // 256개 한국어 단어 사전에서 12개 비중복 무작위 선택
    // 복구 키의 해시만 vault-meta에 저장 (키 자체는 저장 안 함)
}
```

### 29.3 생체 인증 연동

- FaceID/TouchID로 로컬 키 잠금 해제 (Secure Enclave)
- 서버는 암호화된 데이터만 저장 (제로 지식)
- 기기별 공개 키 등록으로 기기 특정 암호화

### 29.4 저장 구조

```
~/.moa-data/vault/
  ├── daily/      # 일별 백업
  ├── weekly/     # 주별 백업
  └── monthly/    # 월별 백업
```

---

## 35. 명령 안전 가드 (Command Safety Guard)

**파일:** `extensions/kakao/src/relay/safety-guard.ts`
**목적:** 쉘 명령 실행 전 위험도 분석 및 차단

### 30.1 위험도 등급

| 등급 | 동작 | 예시 |
|------|------|------|
| **Critical** | 즉시 차단 | `rm -rf /`, `mkfs.`, fork bomb, `shutdown` |
| **High** | `/확인` 승인 필요 | `rm`, `sudo`, `chmod`, `git reset`, SSH/SCP |
| **Medium** | 경고 표시 | `mkdir`, `touch`, `echo >`, `git add/commit` |
| **Low** | 자동 실행 | `ls`, `cat`, `pwd`, 클립보드, 스크린샷 |

### 30.2 민감 경로 감지 (160+ 패턴)

```rust
fn is_sensitive_path(path: &str) -> bool {
    // .ssh/, .env, credentials, token, .pem, .key, .cert 등
    // 160개 이상의 패턴 매칭
}
```

### 30.3 입력 위생 처리

```rust
fn sanitize_input(input: &str) -> String {
    // 제어 문자 (0x00-0x1F, 0x7F) 제거
    input.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect()
}
```

---

## 36. 속도 제한 (3-Strike 시스템)

**파일:** `apps/gateway/src/security/rate-limiter.ts`
**목적:** 무차별 대입 공격 방지를 위한 에스컬레이션 속도 제한

### 31.1 에스컬레이션 규칙

| Strike | 벌칙 | 조건 |
|--------|------|------|
| 1차 | 30분 쿨다운 + 경고 | 1분간 30회 초과 |
| 2차 | 1시간 쿨다운 + 최종 경고 | 쿨다운 중 재시도 |
| 3차 | **영구 차단** (관리자 해제 필요) | 2차 이후 재시도 |

### 31.2 구현 사양

```rust
struct RateLimiter {
    limit: u32,              // 30 (기본)
    window_ms: u64,          // 60,000 (1분)
    stale_cleanup_ms: u64,   // 7,200,000 (2시간)
}

// 키: "{channel}:{userId}"
// 알고리즘: 슬라이딩 윈도우 (인메모리)
// 관리자 기능: reset(), unban()
```

---

## 37. 보안 감사 시스템

**파일:** `src/security/audit.ts`, `apps/web/src/lib/security.ts`
**목적:** 시스템 전반의 보안 상태 점검 및 이벤트 로깅

### 32.1 감사 점검 항목

| 카테고리 | 점검 항목 |
|----------|----------|
| 파일시스템 | 상태 디렉터리 권한, 설정 파일 world-readable 여부 |
| 게이트웨이 | bind 주소, 인증 토큰 길이, Tailscale 모드 |
| 브라우저 | CDP 보안 (HTTP vs HTTPS) |
| 로깅 | 리다크션 활성화 여부 |
| 실행 권한 | 와일드카드 감지 |
| 채널 보안 | DM 정책, 허용 목록, 슬래시 명령 제한 |
| 설정 비밀 | 설정에 시크릿 노출 여부 |
| 플러그인 | 신뢰 여부 |

### 32.2 보안 이벤트 로깅

```rust
struct SecurityEvent {
    user_id: String,  // SHA-256 해시 (첫 16자만)
    event_type: SecurityEventType,
    details: serde_json::Value,
    severity: Severity,  // info | warning | critical
    created_at: DateTime,
}

enum SecurityEventType {
    RateLimitHit,
    SensitiveDataDetected,
    SuspiciousInput,
    AuthFailure,
    BruteForceAttempt,
    InjectionAttempt,
    SessionCreated,
    SessionExpired,
    ChannelAccess,
    ApiKeyUsed,
}
```

### 32.3 로그 리다크션

API 키, 토큰 등이 로그에 노출되지 않도록 자동 리다크션:

```rust
// 마스킹 대상 토큰 프리픽스:
// sk-*, ghp_*, github_pat_*, xox*, xapp-*, gsk_*, AIza*, pplx-*, npm_*
// ENV 변수: KEY=, SECRET=, TOKEN=, PASSWORD=
// Bearer 토큰, PEM 블록

// 출력 형식: "sk-abc...wxyz" (앞 6자 + 뒤 4자)
```

---

## 부록 A: ZeroClaw 마이그레이션 체크리스트 (업데이트)

### 필수 구현 순서 (의존성 기반)

```
Phase 1 - 기반:
  [ ] E2E 암호화 모듈 (AES-256-GCM, PBKDF2)
  [ ] Supabase 클라이언트
  [ ] 데이터베이스 스키마 생성
  [ ] 사용자 설정 관리 (해시, 암호화)

Phase 2 - 보안 (확장):
  [ ] 보안 가드 (위협 감지, 패턴 매칭)
  [ ] 보안 미들웨어 (선차단 후 동의)
  [ ] 행동 권한 시스템
  [ ] 속도 제한 (3-Strike 에스컬레이션)
  [ ] 세션 관리
  [ ] 디바이스 바인딩 암호화 (PBKDF2 200K)
  [ ] 데이터 마스킹 (44+ 패턴)
  [ ] 명령 안전 가드 (위험도 4등급)
  [ ] 보안 감사 시스템
  [ ] 로그 리다크션

Phase 3 - 기기 보안:
  [ ] 원격 잠금/삭제 (Remote Wipe)
  [ ] 분실 기기 위치 추적 (GPS)
  [ ] 분실 잠금 모드 (Lockdown)
  [ ] 암호화 백업 볼트 (Time Machine)
  [ ] 복구 키 (12단어 한국어 니모닉)
  [ ] 3-pass 보안 삭제

Phase 4 - AI 라우팅:
  [ ] SLM 로컬 게이트키퍼 (Ollama + Qwen3)
  [ ] 멀티 프로바이더 LLM 라우팅
  [ ] 모델 전략 시스템
  [ ] 클라우드 디스패처
  [ ] 오프라인 큐

Phase 5 - 빌링:
  [ ] 크레딧/빌링 시스템
  [ ] 모델별 가격표
  [ ] 원자적 크레딧 차감
  [ ] 결제 연동 (Kakao Pay)

Phase 6 - 동기화:
  [ ] 메모리 동기화 엔진
  [ ] 동기화 재조정기 (Version Vector, Delta Journal)
  [ ] 수동 전체 동기화
  [ ] 상태 저장/복원

Phase 7 - 채널:
  [ ] KakaoTalk 웹훅 서버
  [ ] 채널 플러그인
  [ ] MoltBot 에이전트 브릿지

Phase 8 - 도구:
  [ ] 의도 분류기
  [ ] 도구 디스패처
  [ ] 각 도구 구현 (날씨, 검색, 일정, 스포츠, 창작 등)
  [ ] Legal RAG

Phase 9 - 음성:
  [ ] 음성 프로바이더 (Gemini Live, OpenAI Realtime)
  [ ] 실시간 통역 시스템
  [ ] 음성 빌링
```

### Rust 특화 고려사항 (확장)

| TypeScript 패턴 | Rust 대안 |
|----------------|----------|
| `Map<string, T>` | `HashMap<String, T>` |
| `Promise<T>` | `async fn -> Result<T>` (tokio) |
| `EventEmitter` | `tokio::sync::broadcast` 또는 `tokio::sync::mpsc` |
| `setTimeout` | `tokio::time::sleep` |
| `RegExp` | `regex` crate |
| `fetch` | `reqwest` crate |
| `crypto` (AES-GCM) | `aes-gcm` crate |
| `crypto` (PBKDF2) | `pbkdf2` crate |
| `crypto` (SHA-256) | `sha2` crate |
| `crypto` (HMAC) | `hmac` crate |
| `zlib` | `flate2` crate |
| Supabase JS SDK | `postgrest-rs` + `realtime-rs` 또는 직접 HTTP |
| JSON 직렬화 | `serde` + `serde_json` |
| WebSocket | `tokio-tungstenite` |
| 파일 시스템 권한 | `std::os::unix::fs::PermissionsExt` |
| 생체 인증 | 플랫폼 네이티브 (iOS: LocalAuthentication, Android: BiometricPrompt) |
| GPS | 플랫폼 네이티브 (iOS: CoreLocation, Android: FusedLocationProviderClient) |
| Secure Enclave | iOS: `SecKeyCreateRandomKey` with kSecAttrTokenIDSecureEnclave |
| `timingSafeEqual` | `subtle::ConstantTimeEq` crate |

---

*이 문서는 MoA 저장소의 OpenClaw 대비 모든 개선사항을 기반으로 작성되었습니다.*
*ZeroClaw(Rust) 마이그레이션 시 이 명세서의 각 섹션을 순서대로 구현하면 됩니다.*
*총 37개 섹션, 9단계 마이그레이션 체크리스트를 포함합니다.*
