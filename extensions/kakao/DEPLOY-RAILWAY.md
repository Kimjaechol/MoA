# Railway 배포 가이드 (LawCall + KakaoTalk)

이 가이드는 Moltbot + KakaoTalk + LawCall을 Railway에 배포하는 방법을 설명합니다.

## 비용 최적화 요약

| 항목 | 월 비용 | 설명 |
|------|--------|------|
| Railway Hobby | $5 | 기본 요금 (500시간 무료) |
| 추가 사용량 | ~$2-5 | 사용량 기반 |
| Claude API | ~$5-15 | 대화량 기반 (~$0.01/대화) |
| **총 예상** | **$10-25/월** | 월 1000건 상담 기준 |

### 비용 절감 팁

1. **Claude Haiku 사용** (기본 Opus 대신)
   - Opus: ~$0.015/대화
   - Haiku: ~$0.0003/대화 (50배 저렴)
   - 법률 안내는 Haiku로도 충분

2. **응답 캐싱** 적용
   - 동일 질문에 대한 캐시 적용

---

## Step 1: GitHub 저장소 준비

### Option A: Fork (추천)

```bash
# GitHub에서 moltbot 저장소 Fork
# https://github.com/moltbot/moltbot → Fork
```

### Option B: Clone & Push

```bash
git clone https://github.com/moltbot/moltbot.git lawcall-bot
cd lawcall-bot
git remote set-url origin https://github.com/YOUR_USERNAME/lawcall-bot.git
git push -u origin main
```

---

## Step 2: Railway 프로젝트 생성

### 2.1 Railway 가입
1. https://railway.app 방문
2. GitHub 계정으로 로그인

### 2.2 새 프로젝트 생성
1. **New Project** 클릭
2. **Deploy from GitHub repo** 선택
3. 저장소 선택 (moltbot 또는 lawcall-bot)

### 2.3 빌드 설정
1. **Settings** → **Build**
2. **Builder**: `Dockerfile`
3. **Dockerfile Path**: `extensions/kakao/Dockerfile`

---

## Step 3: 환경변수 설정

Railway Dashboard → **Variables** 탭에서 설정:

### 필수 변수

```bash
# Claude API (LLM)
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx

# Kakao API
KAKAO_ADMIN_KEY=your_rest_api_key_here
```

### LawCall 라우팅 (핵심!)

```bash
# 분야별 URL 설정
LAWCALL_ROUTES={"민사":"https://lawcall.com/civil","형사":"https://lawcall.com/criminal","이혼":"https://lawcall.com/family","세무":"https://lawcall.com/tax","행정":"https://lawcall.com/admin","헌법":"https://lawcall.com/constitutional","기본":"https://lawcall.com"}

# 변호사/서비스 정보
LAWCALL_LAWYER_NAME=김재철 변호사
LAWCALL_SERVICE_NAME=LawCall
```

### 비용 절감 설정 (선택)

```bash
# 저렴한 모델 사용
MOLTBOT_MODEL=claude-3-haiku-20240307

# 간결한 응답 설정
MOLTBOT_MAX_TOKENS=500
```

---

## Step 4: 도메인 설정

### 4.1 Railway 도메인 생성
1. **Settings** → **Networking**
2. **Generate Domain** 클릭
3. 도메인 복사: `lawcall-bot.up.railway.app`

### 4.2 커스텀 도메인 (선택)
1. **Custom Domain** 클릭
2. 도메인 입력: `api.lawcall.com`
3. DNS 설정:
   ```
   Type: CNAME
   Name: api
   Value: lawcall-bot.up.railway.app
   ```

---

## Step 5: Kakao i Open Builder 설정

### 5.1 Kakao Developers 앱 생성
1. https://developers.kakao.com 방문
2. **내 애플리케이션** → **애플리케이션 추가하기**
3. 앱 생성 후 **앱 키** 복사
   - REST API 키 → `KAKAO_ADMIN_KEY`

### 5.2 Kakao i Open Builder 스킬 설정
1. https://i.kakao.com 방문
2. 봇 선택 또는 생성
3. **스킬** → **스킬 생성**
4. 스킬 정보 입력:
   - **스킬명**: LawCall AI
   - **설명**: LawCall 법률상담 AI
   - **URL**: `https://lawcall-bot.up.railway.app/kakao/webhook`

### 5.3 시나리오 연결
1. **시나리오** → **시나리오 생성**
2. **폴백 블록** 선택 (모든 메시지 처리)
3. **스킬 호출** → LawCall AI 스킬 선택
4. **배포** 클릭

---

## Step 6: 테스트

### 6.1 Health Check
```bash
curl https://lawcall-bot.up.railway.app/health
# Expected: ok
```

### 6.2 카카오톡에서 테스트
1. 카카오톡 → 채널 검색
2. 생성한 채널 찾기
3. 친구 추가
4. 메시지 전송: "전세사기 당했어요"

### 예상 응답:
```
전세사기 피해를 당하셨군요. 정말 힘드시겠습니다.

일반적으로 전세사기 피해 시 다음 조치를 고려해볼 수 있습니다:
1. 경찰 신고 (사기죄)
2. 임차권등기명령 신청
...

이 문제는 전문 변호사의 상담이 필요해 보입니다.
김재철 변호사님이 운영하시는 LawCall에서
AI 법률 상담을 받아보세요.

[민사 상담 바로가기] ← 버튼
```

---

## Step 7: 운영

### 로그 확인
```bash
# Railway CLI 설치
npm install -g @railway/cli
railway login

# 로그 확인
railway logs
```

### 분야 추가/수정

Railway Dashboard → **Variables**:

```bash
# 노동법 분야 추가
LAWCALL_ROUTES={"민사":"...","형사":"...","노동":"https://lawcall.com/labor",...}
```

저장 후 자동 재시작됩니다 (재배포 불필요).

### 모니터링
- Railway Dashboard → **Metrics**
- CPU, 메모리, 요청 수 확인

---

## 문제 해결

### 웹훅 응답 없음
1. Railway 로그 확인: `railway logs`
2. 스킬 URL 확인 (HTTPS 필수)
3. Health check: `curl https://your-app.up.railway.app/health`

### 5초 타임아웃
Kakao i Open Builder는 5초 타임아웃이 있습니다.
- 해결: Haiku 모델 사용 (더 빠름)
- `MOLTBOT_MODEL=claude-3-haiku-20240307`

### API 키 오류
1. 환경변수 확인
2. Kakao REST API 키가 맞는지 확인 (Admin Key 아님)

---

## 비용 모니터링

### Railway 사용량 확인
1. Railway Dashboard → **Usage**
2. 월별 사용량 및 예상 비용 확인

### Claude API 사용량 확인
1. https://console.anthropic.com/
2. **Usage** 탭에서 일별/월별 사용량 확인

### 예산 알림 설정
1. Anthropic Console → **Settings** → **Billing**
2. **Usage Alerts** 설정

---

## 다음 단계

- [ ] 카카오 비즈니스 채널 승인
- [ ] 랜딩페이지 제작
- [ ] 사용자 통계 수집
- [ ] Friend Talk 설정 (푸시 알림용, 유료)
