# KakaoMolt - AI 통합 카카오톡 챗봇

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

카카오톡 채널을 통해 다양한 AI 서비스를 제공하는 Moltbot 플러그인입니다. 법률 상담, 날씨/일정 조회, AI 이미지/음악 생성 등 풍부한 기능을 제공합니다.

## 주요 기능

### 1. AI 법률 상담 (LawCall 연동)
- Claude/GPT 기반의 지능형 법률 상담
- 법령/판례 RAG 검색 (국가법령정보센터 연동)
- 6개 전문 분야별 맞춤 상담 연결 (민사, 형사, 이혼, 세무, 행정, 헌법)

### 2. 일상 정보 조회 도구
- **날씨 조회**: 기상청 API 연동, 시간별/주간 예보
- **일정 조회**: Google Calendar + 카카오 톡캘린더 통합
- **스포츠 일정**: KBO, K리그, NBA, EPL 등 경기 일정/결과
- **공공 데이터**: 공휴일, 대기질(미세먼지) 정보

### 3. AI 웹 검색 (RAG)
- **Perplexity AI**: 실시간 웹 검색 기반 답변
- **Google AI Search**: Gemini Grounding 검색
- 뉴스, 시세, 최신 정보 실시간 검색

### 4. 창작 AI
- **이미지 생성**: DALL-E 3, Stable Diffusion
- **이모티콘/스티커**: 귀여운 캐릭터 생성
- **음악 생성**: Suno AI, Mubert 배경음악
- **QR 코드**: URL/텍스트 QR 코드 생성

### 5. 크레딧 기반 과금 시스템
- **무료 이용**: 사용자가 자신의 API 키를 등록하면 무료로 이용
- **크레딧 이용**: API 키가 없는 경우 크레딧으로 이용 (API 비용의 2배)
- **신규 사용자 혜택**: 1,000 크레딧 무료 제공

### 6. 토스페이먼츠 결제 연동
- 4가지 크레딧 패키지 (5,000원 ~ 50,000원)
- 대용량 패키지 보너스 크레딧 제공
- 안전한 결제 처리 및 환불 지원

### 7. E2E 암호화 메모리 동기화
- **다중 기기 동기화**: 휴대폰, PC, 노트북 간 AI 메모리 동기화
- **AES-256-GCM 암호화**: 종단간 암호화로 서버에서도 데이터 열람 불가
- **PBKDF2 키 파생**: 사용자 암호로부터 안전한 키 생성
- **증분 동기화**: 변경된 부분만 동기화하여 대역폭 절약
- **자동 만료**: 임시 데이터 자동 삭제로 프라이버시 보호

### 8. 보안
- AES-256 암호화로 API 키 안전 저장
- SHA-256 해시로 사용자 ID 프라이버시 보호
- Supabase Row Level Security 적용
- E2E 암호화로 메모리 데이터 보호 (서버도 열람 불가)

## 아키텍처

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   카카오톡 앱    │────▶│  Kakao i 오픈빌더  │────▶│   KakaoMolt     │
│   (사용자)       │◀────│    (웹훅 전달)     │◀────│   (Railway)     │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌─────────────────────────────────┼─────────────────────────────────┐
                        │                                 │                                 │
                        ▼                                 ▼                                 ▼
                ┌───────────────┐              ┌──────────────────┐              ┌──────────────────┐
                │   Supabase    │              │  Claude/OpenAI   │              │    LawCall       │
                │   Database    │              │      API         │              │    웹앱          │
                └───────────────┘              └──────────────────┘              └──────────────────┘
```

## 시작하기

### 사전 요구사항

1. **카카오 비즈니스 계정**
   - [카카오 비즈니스](https://business.kakao.com/)에서 채널 생성
   - [카카오 개발자](https://developers.kakao.com/)에서 앱 생성 및 Admin Key 발급

2. **Supabase 프로젝트**
   - [Supabase](https://supabase.com/)에서 프로젝트 생성
   - URL 및 Service Key 발급

3. **LLM API 키**
   - [Anthropic Console](https://console.anthropic.com/) - Claude API
   - 또는 [OpenAI Platform](https://platform.openai.com/) - GPT API

4. **토스페이먼츠 계정** (크레딧 결제 사용 시)
   - [토스페이먼츠 개발자센터](https://developers.tosspayments.com/)에서 키 발급

### 설치 및 배포

#### 1. 저장소 클론

```bash
git clone https://github.com/Kimjaechol/kakaomolt.git
cd kakaomolt
```

#### 2. Supabase 데이터베이스 설정

Supabase SQL Editor에서 `supabase-schema.sql` 실행:

```bash
# 또는 Supabase CLI 사용
supabase db push
```

#### 3. Railway 배포

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

**환경 변수 설정:**

```env
# 필수: LLM API
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx

# 필수: 카카오 API
KAKAO_ADMIN_KEY=your_admin_key_here

# 필수: Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# 필수: LawCall 라우팅
LAWCALL_ROUTES={"민사":"https://lawcall.com/civil","형사":"https://lawcall.com/criminal","이혼":"https://lawcall.com/family","세무":"https://lawcall.com/tax","행정":"https://lawcall.com/admin","헌법":"https://lawcall.com/constitutional","기본":"https://lawcall.com"}
LAWCALL_LAWYER_NAME=김재철 변호사
LAWCALL_SERVICE_NAME=LawCall

# 결제 (선택)
TOSS_CLIENT_KEY=test_ck_xxxxxxxx
TOSS_SECRET_KEY=test_sk_xxxxxxxx
LAWCALL_BASE_URL=https://your-domain.railway.app

# 보안 (권장)
LAWCALL_ENCRYPTION_KEY=your-32-char-encryption-key-here
LAWCALL_USER_SALT=your-random-salt-here
```

#### 4. 카카오 i 오픈빌더 설정

1. [카카오 i 오픈빌더](https://i.kakao.com/) 접속
2. 새 봇 생성 → 스킬 서버 추가
3. 웹훅 URL 설정: `https://your-app.railway.app/kakao/webhook`
4. 발화 블록에 스킬 연결

자세한 설정 가이드는 [DEPLOY-RAILWAY.md](./DEPLOY-RAILWAY.md)를 참조하세요.

## 사용 방법

### 일상 정보 조회

| 예시 | 기능 |
|------|------|
| `서울 날씨 알려줘` | 날씨 조회 |
| `내일 미세먼지 어때?` | 대기질 조회 |
| `오늘 일정 뭐 있어?` | Google + 톡캘린더 조회 |
| `이번 주 공휴일` | 공휴일 조회 |
| `오늘 KBO 야구 경기` | 스포츠 일정 조회 |
| `두산 경기 언제야?` | 팀별 경기 조회 |

### AI 웹 검색

| 예시 | 기능 |
|------|------|
| `오늘 주요 뉴스` | 최신 뉴스 검색 |
| `비트코인 시세` | 실시간 시세 검색 |
| `2026년 대선 후보` | 최신 정보 검색 |

### 창작 AI

| 예시 | 기능 |
|------|------|
| `귀여운 고양이 그림 그려줘` | 이미지 생성 |
| `연인에게 보낼 하트 이미지 만들어줘` | 하트 이미지 생성 |
| `슬픈 표정 이모티콘 만들어줘` | 이모티콘 생성 |
| `잔잔한 배경음악 만들어줘` | 음악 생성 |
| `https://lawcall.com QR 만들어줘` | QR 코드 생성 |

### 법률 정보/상담

| 예시 | 기능 |
|------|------|
| `손해배상 관련 법률 알려줘` | 법령 RAG 검색 |
| `명예훼손 판례 찾아줘` | 판례 검색 |
| `이혼 상담 받고 싶어요` | 전문 상담 연결 (LawCall) |

### 크레딧 관리

| 명령어 | 설명 |
|--------|------|
| `잔액` / `크레딧` | 현재 크레딧 잔액 확인 |
| `충전` | 크레딧 충전 패키지 선택 |
| `요금 안내` | 요금제 및 가격 정보 확인 |
| `결제내역` | 최근 결제 내역 조회 |
| `API키 등록` | 자신의 API 키 등록 안내 |

### 메모리 동기화

여러 기기에서 AI 메모리를 동기화할 수 있습니다. 모든 데이터는 사용자만 알 수 있는 암호로 암호화됩니다.

| 명령어 | 설명 |
|--------|------|
| `/동기화 설정 <암호>` | 동기화 시작 (8자 이상 암호) |
| `/동기화 업로드` | 현재 기기 메모리를 클라우드에 업로드 |
| `/동기화 다운로드` | 클라우드에서 메모리 가져오기 |
| `/동기화 상태` | 동기화 상태 확인 |
| `/동기화 기기목록` | 연결된 기기 목록 |
| `/동기화 삭제` | 모든 동기화 데이터 삭제 |

**사용 예시:**

```
사용자: /동기화 설정 MySecretPassword123

봇: ✅ 동기화 설정 완료!

    🔐 복구 코드: ABCD-EFGH-IJKL-MNOP

    ⚠️ 이 복구 코드를 안전한 곳에 저장하세요.
    암호를 잊어버렸을 때 필요합니다.

    이제 "/동기화 업로드"로 메모리를 업로드하세요.
```

### API 키 등록 (무료 이용)

사용자가 자신의 LLM API 키를 등록하면 크레딧 차감 없이 무료로 이용할 수 있습니다:

```
API키 등록 sk-ant-api03-xxxxxxxxx
```

### 법률 상담 예시

```
사용자: 이웃집에서 시끄럽게 해서 너무 힘들어요. 어떻게 해야 하나요?

봇: [법률 상담 응답]
    ...
    📚 관련 법령: 민법 제217조 (생활방해금지), 제750조 (불법행위)

    📋 전문 변호사와 상담하시겠어요?
    [🔗 민사 상담 신청하기] ← 버튼
```

## 크레딧 요금제

| 모델 | 입력 토큰 (1K) | 출력 토큰 (1K) |
|------|---------------|---------------|
| Claude 3 Haiku | 1 크레딧 | 5 크레딧 |
| Claude 3.5 Sonnet | 6 크레딧 | 30 크레딧 |
| Claude 3 Opus | 30 크레딧 | 150 크레딧 |
| GPT-4o | 10 크레딧 | 30 크레딧 |
| GPT-4o-mini | 1 크레딧 | 4 크레딧 |

### 충전 패키지

| 패키지 | 가격 | 크레딧 | 보너스 |
|--------|------|--------|--------|
| 기본 | 5,000원 | 5,000 | - |
| 표준 | 10,000원 | 10,000 | +1,000 |
| 프리미엄 | 20,000원 | 20,000 | +3,000 |
| 프로 | 50,000원 | 50,000 | +10,000 |

## 프로젝트 구조

```
kakaomolt/
├── index.ts                    # 메인 엔트리포인트
├── src/
│   ├── api-client.ts           # Kakao API 클라이언트
│   ├── webhook.ts              # 웹훅 핸들러
│   ├── intent-classifier.ts    # 의도 분류기
│   ├── tool-dispatcher.ts      # 도구 디스패처
│   ├── billing.ts              # 크레딧 관리 (Supabase)
│   ├── billing-handler.ts      # 과금 명령어 처리
│   ├── payment.ts              # 토스페이먼츠 연동
│   ├── lawcall-router.ts       # 법률 카테고리 라우팅
│   ├── supabase.ts             # Supabase 클라이언트
│   ├── tools/                  # 도구 모음
│   │   ├── index.ts            # 도구 레지스트리
│   │   ├── weather.ts          # 날씨 조회 (기상청 API)
│   │   ├── calendar.ts         # 캘린더 (Google + 카카오)
│   │   ├── sports.ts           # 스포츠 일정 (ESPN)
│   │   ├── public-data.ts      # 공공데이터 (공휴일, 대기질)
│   │   ├── search.ts           # AI 검색 (Perplexity, Google)
│   │   └── creative.ts         # 창작 AI (이미지, 음악, QR)
│   ├── rag/
│   │   ├── index.ts            # RAG 인덱스
│   │   └── legal-rag.ts        # 법률 RAG (법령, 판례)
│   └── sync/                   # E2E 암호화 메모리 동기화
│       ├── index.ts            # 동기화 모듈 인덱스
│       ├── encryption.ts       # AES-256-GCM 암호화
│       ├── memory-sync.ts      # 메모리 동기화 매니저
│       └── sync-commands.ts    # 동기화 명령어 핸들러
├── supabase-schema.sql         # 데이터베이스 스키마 (동기화 테이블 포함)
├── Dockerfile                  # 컨테이너 설정
├── docker-compose.yml          # 로컬 개발 환경
├── railway.json                # Railway 배포 설정
├── fly.toml                    # Fly.io 배포 설정
└── .env.example                # 환경 변수 예시
```

## 개발

### 로컬 실행

```bash
# 의존성 설치
pnpm install

# 환경 변수 설정
cp .env.example .env
# .env 파일 편집

# 개발 서버 실행
pnpm dev

# ngrok으로 터널링 (선택)
ngrok http 8788
```

### Docker 실행

```bash
docker-compose up -d
```

## 라이선스

MIT License - 자세한 내용은 [LICENSE](./LICENSE) 파일을 참조하세요.

## 기여

버그 리포트, 기능 제안, Pull Request를 환영합니다!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 문의

- GitHub Issues: [https://github.com/Kimjaechol/kakaomolt/issues](https://github.com/Kimjaechol/kakaomolt/issues)
- LawCall 서비스: [https://lawcall.com](https://lawcall.com)
