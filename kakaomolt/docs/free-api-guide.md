# 무료 AI API 등록 가이드

KakaoMolt에서 무료로 AI를 사용하는 방법을 안내합니다.

## 🆓 무료 API 추천 순위

| 순위 | 서비스 | 무료 혜택 | 추천 이유 |
|------|--------|----------|----------|
| 1 | **Google Gemini** | 월 1,500회 무료 | 성능 우수, 한국어 지원 |
| 2 | **Groq** | 완전 무료 | 초고속 응답, 오픈소스 모델 |
| 3 | **OpenRouter** | $1 무료 크레딧 | 다양한 모델 선택 |
| 4 | **Together AI** | $25 무료 크레딧 | 고성능 오픈소스 모델 |

---

## 1. Google Gemini API (가장 추천!)

### 무료 혜택
- 월 1,500회 무료 요청
- Gemini 2.0 Flash 모델 (최신!)
- 1,000,000 토큰 컨텍스트

### 등록 방법

1. **Google AI Studio 접속**
   ```
   https://aistudio.google.com
   ```

2. **Google 계정으로 로그인**

3. **API 키 생성**
   - 좌측 메뉴에서 "Get API Key" 클릭
   - "Create API Key" 버튼 클릭
   - 프로젝트 선택 (없으면 새로 생성)

4. **API 키 복사**
   ```
   AIzaSy...로 시작하는 키 복사
   ```

5. **KakaoMolt에 등록**
   - 카카오톡에서 API 키를 그대로 붙여넣기
   - 자동으로 Google Gemini로 인식됩니다

### 사용 가능 모델
- **Gemini 2.0 Flash** (추천) - 빠르고 무료
- Gemini 1.5 Flash - 무료
- Gemini 1.5 Pro - 유료

---

## 2. Groq API (초고속!)

### 무료 혜택
- **완전 무료** (속도 제한만 있음)
- 분당 30회 요청 제한
- Llama 3.3 70B, Mixtral 8x7B 등

### 등록 방법

1. **Groq Console 접속**
   ```
   https://console.groq.com
   ```

2. **계정 생성**
   - 이메일, Google, 또는 GitHub으로 가입

3. **API 키 생성**
   - 좌측 메뉴에서 "API Keys" 클릭
   - "Create API Key" 버튼 클릭
   - 이름 입력 후 생성

4. **API 키 복사**
   ```
   gsk_...로 시작하는 키 복사
   ```

5. **KakaoMolt에 등록**
   - 카카오톡에서 API 키를 그대로 붙여넣기

### 사용 가능 모델
- **Llama 3.3 70B** (추천) - 무료, 고성능
- Mixtral 8x7B - 무료, 빠름
- Gemma 2 9B - 무료, 가벼움

### Groq의 장점
- **초고속 응답** - 다른 서비스 대비 10배 빠름
- 완전 무료
- 최신 오픈소스 모델 지원

---

## 3. OpenRouter API

### 무료 혜택
- $1 무료 크레딧 (가입 시)
- 일부 모델 무료 (`:free` 모델)

### 등록 방법

1. **OpenRouter 접속**
   ```
   https://openrouter.ai
   ```

2. **계정 생성**
   - Google 또는 이메일로 가입

3. **API 키 생성**
   - 상단 메뉴에서 "Keys" 클릭
   - "Create Key" 버튼 클릭

4. **API 키 복사**
   ```
   sk-or-...로 시작하는 키 복사
   ```

### 무료 모델
- `google/gemini-2.0-flash-exp:free`
- `meta-llama/llama-3.3-70b-instruct:free`

---

## 4. Together AI

### 무료 혜택
- 가입 시 $25 무료 크레딧
- 저렴한 가격 (1M 토큰 당 약 100원)

### 등록 방법

1. **Together AI 접속**
   ```
   https://api.together.xyz
   ```

2. **계정 생성**

3. **API 키 생성**
   - Settings > API Keys
   - "Create API Key" 클릭

4. **API 키 복사**
   ```
   64자리 16진수 문자열 복사
   ```

---

## 5. Anthropic Claude (유료)

고품질 응답이 필요한 경우 추천합니다.

### 가격
- Claude 3.5 Haiku: 약 1-2원/대화
- Claude 3.5 Sonnet: 약 10-20원/대화

### 등록 방법

1. **Anthropic Console 접속**
   ```
   https://console.anthropic.com
   ```

2. **계정 생성 및 결제 수단 등록**

3. **API 키 생성**
   - Settings > API Keys
   - "Create Key" 클릭

4. **API 키 복사**
   ```
   sk-ant-...로 시작하는 키 복사
   ```

---

## 6. OpenAI GPT (유료)

ChatGPT와 동일한 모델을 사용합니다.

### 가격
- GPT-4o-mini: 약 2-3원/대화
- GPT-4o: 약 10-20원/대화

### 등록 방법

1. **OpenAI Platform 접속**
   ```
   https://platform.openai.com
   ```

2. **계정 생성 및 결제 수단 등록**

3. **API 키 생성**
   - API Keys 메뉴
   - "Create new secret key" 클릭

4. **API 키 복사**
   ```
   sk-...로 시작하는 키 복사
   ```

---

## FAQ

### Q: 어떤 API를 선택해야 하나요?

**무료로 시작하고 싶다면:**
- Google Gemini (품질 좋음) 또는 Groq (속도 빠름)

**최고 품질을 원한다면:**
- Anthropic Claude

**가성비를 원한다면:**
- Together AI 또는 Groq

### Q: API 키는 안전한가요?

- 모든 API 키는 AES-256으로 암호화되어 저장됩니다
- 서버에서도 복호화된 키를 로그에 남기지 않습니다
- 언제든지 원본 서비스에서 키를 삭제/재생성할 수 있습니다

### Q: 여러 개의 API 키를 등록할 수 있나요?

네! 여러 서비스의 API 키를 등록하고, "모델 변경" 명령으로 전환할 수 있습니다.

예: `모델 gemini`, `모델 llama`, `모델 haiku`

### Q: 크레딧이 부족하면 어떻게 되나요?

"자동 전환" 기능이 켜져 있으면 무료 모델(Gemini/Groq)로 자동 전환됩니다.

---

## 명령어 요약

| 명령어 | 설명 |
|--------|------|
| `API키 등록` | API 키 등록 가이드 |
| `Gemini 무료` | Google Gemini 등록 가이드 |
| `Groq 무료` | Groq 등록 가이드 |
| `모델 선택` | 사용 가능한 모델 목록 |
| `모델 gemini` | Gemini 모델로 변경 |
| `모델 haiku` | Claude Haiku로 변경 |
| `모델 llama` | Llama 모델로 변경 |
| `잔액` | 크레딧 잔액 확인 |
| `API키 상태` | 등록된 API 키 확인 |
| `자동 전환 켜기/끄기` | 무료 모델 자동 전환 설정 |
