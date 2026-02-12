# KakaoTalk + MoA 완벽 설정 가이드

이 가이드는 MoA를 카카오톡에서 사용할 수 있도록 설정하는 전체 과정을 순서대로 안내합니다.
알림톡(AlimTalk) 설정까지 포함되어 있습니다.

---

## 목차

1. [전체 구조 이해](#1-전체-구조-이해)
2. [STEP 1: 카카오 디벨로퍼스 앱 생성](#step-1-카카오-디벨로퍼스-앱-생성)
3. [STEP 2: 카카오톡 채널 생성](#step-2-카카오톡-채널-생성)
4. [STEP 3: 카카오 i 오픈빌더 챗봇 설정](#step-3-카카오-i-오픈빌더-챗봇-설정)
5. [STEP 4: Railway 또는 Vercel에 MoA 배포](#step-4-railway-또는-vercel에-moa-배포)
6. [STEP 5: 오픈빌더에 스킬 URL 연결](#step-5-오픈빌더에-스킬-url-연결)
7. [STEP 6: NHN Cloud 알림톡/친구톡 설정](#step-6-nhn-cloud-알림톡친구톡-설정)
8. [STEP 7: Railway/Vercel 환경변수 최종 입력](#step-7-railwayvercel-환경변수-최종-입력)
9. [STEP 8: 배포 및 테스트](#step-8-배포-및-테스트)
10. [환경변수 전체 목록 및 설명](#환경변수-전체-목록-및-설명)
11. [문제 해결 (트러블슈팅)](#문제-해결-트러블슈팅)

---

## 1. 전체 구조 이해

```
사용자 카카오톡
    ↓ 메시지 전송
카카오 i 오픈빌더 (챗봇)
    ↓ POST /kakao/webhook
Railway/Vercel (MoA 서버)
    ↓ AI 처리 (Claude/GPT 등)
    ↓ 응답 생성
카카오 i 오픈빌더
    ↓ 응답 전달
사용자 카카오톡
```

**알림톡/친구톡 (Proactive Messaging):**
```
MoA 서버 → NHN Cloud Toast API → 카카오톡 알림톡/친구톡 → 사용자
```

### 필요한 서비스 계정

| 서비스 | URL | 용도 |
|--------|-----|------|
| Kakao Developers | https://developers.kakao.com | 앱 키 발급 |
| Kakao i 오픈빌더 | https://i.kakao.com | 챗봇 생성/관리 |
| 카카오톡 채널 관리자센터 | https://center-pf.kakao.com | 채널 생성/관리 |
| 카카오 비즈니스 | https://business.kakao.com | 비즈니스 인증 |
| NHN Cloud | https://www.nhncloud.com | 알림톡/친구톡 API |
| Railway | https://railway.app | MoA 서버 배포 |
| Anthropic Console | https://console.anthropic.com | Claude API 키 |

---

## STEP 1: 카카오 디벨로퍼스 앱 생성

### 1.1 카카오 디벨로퍼스 가입/로그인

1. https://developers.kakao.com 접속
2. 카카오 계정으로 **로그인**
3. 처음이면 **개발자 등록** 진행 (이메일 인증)

### 1.2 애플리케이션 생성

1. 상단 메뉴 **내 애플리케이션** 클릭
2. **애플리케이션 추가하기** 클릭
3. 정보 입력:
   - **앱 이름**: `MoA` (또는 원하는 이름)
   - **사업자명**: 본인/회사 이름
   - **카테고리**: 유틸리티 > 기타
4. **저장** 클릭

### 1.3 앱 키 갈무리 (중요!)

애플리케이션이 생성되면 **앱 키** 페이지에서 다음 키를 **메모장에 복사**해 두세요:

| 키 이름 | 환경변수 | 설명 |
|---------|---------|------|
| **REST API 키** | `KAKAO_ADMIN_KEY` | 서버에서 카카오 API 호출 시 사용 (필수) |
| **JavaScript 키** | `KAKAO_APP_KEY` | 웹 프론트엔드에서 사용 (선택) |
| **Admin 키** | (참고용) | 관리자 권한 API 호출 시 사용 |

> **주의**: Admin 키는 절대 외부에 노출하지 마세요!

### 1.4 플랫폼 설정

1. 좌측 메뉴 **앱 설정** > **플랫폼**
2. **Web 플랫폼 등록** 클릭
3. **사이트 도메인** 입력:
   - Railway: `https://YOUR-APP.up.railway.app`
   - Vercel: `https://mymoa.app` (또는 커스텀 도메인)
4. **저장**

### 1.5 카카오 로그인 활성화 (선택)

> 사용자 프로필 정보가 필요한 경우에만 설정합니다.

1. 좌측 **제품 설정** > **카카오 로그인**
2. **활성화 설정** ON
3. **Redirect URI** 추가: `https://YOUR-APP.up.railway.app/auth/kakao/callback`

---

## STEP 2: 카카오톡 채널 생성

카카오톡 채널은 사용자가 친구 추가하여 대화하는 공식 채널(구 플러스친구)입니다.

### 2.1 채널 생성

1. https://center-pf.kakao.com 접속 (카카오톡 채널 관리자센터)
2. **새 채널 만들기** 클릭
3. 정보 입력:
   - **채널 이름**: `MoA AI 어시스턴트` (또는 원하는 이름)
   - **검색용 아이디**: `@moaai` (또는 원하는 고유 아이디)
   - **카테고리**: IT/인터넷 > 소프트웨어
   - **프로필 사진**: MoA 로고 업로드
4. **확인**

### 2.2 채널 공개 설정 (필수!)

1. 채널 관리자센터 > **관리** > **상세설정**
2. **프로필 공개** > **홈 공개** 설정
3. **채널 검색 허용** ON

> 공개 설정을 하지 않으면 오픈빌더 연동 및 알림톡 발신 프로필 등록이 안 됩니다!

### 2.3 채널 ID 갈무리

1. 채널 관리자센터 > **관리** > **상세설정**
2. **채널 URL** 또는 **채널 ID** 확인
   - 형식: `@moaai` 또는 숫자 ID
3. 이 값을 메모 → 나중에 `KAKAO_CHANNEL_ID` 환경변수로 사용

### 2.4 카카오 디벨로퍼스 앱에 채널 연결

1. https://developers.kakao.com > **내 애플리케이션** > MoA 앱 선택
2. 좌측 **제품 설정** > **카카오톡 채널**
3. **채널 연결** 클릭
4. 위에서 만든 채널 선택 후 **연결**

---

## STEP 3: 카카오 i 오픈빌더 챗봇 설정

오픈빌더는 카카오톡 채널에서 동작하는 챗봇을 만드는 도구입니다.

### 3.1 오픈빌더 접속

1. https://i.kakao.com 접속
2. 카카오 계정으로 로그인
3. 처음이면 **챗봇 관리자센터** 이용 동의

### 3.2 봇 생성

1. **봇 만들기** 클릭
2. 정보 입력:
   - **봇 이름**: `MoA`
   - **설명**: MoA AI 어시스턴트
3. **확인** 클릭

### 3.3 봇에 채널 연결

1. 봇 선택 > **설정** > **기본 설정**
2. **카카오톡 채널 연결** 섹션
3. STEP 2에서 만든 채널 선택
4. **저장**

### 3.4 스킬(Skill) 생성

이것이 MoA 서버와 연결되는 핵심 설정입니다.

1. 좌측 **스킬** 메뉴 클릭
2. **생성** 버튼 클릭
3. 스킬 정보 입력:
   - **스킬명**: `MoA AI`
   - **설명**: MoA AI 어시스턴트 응답 스킬
   - **URL**: (STEP 4 배포 후 입력 — 아래에서 안내)
     - 형식: `https://YOUR-APP.up.railway.app/kakao/webhook`
   - **헤더값**: (비워두거나 필요시 인증 토큰 입력)
   - **기본 스킬**: 체크
4. **저장**

> URL은 Railway 배포 후에 입력합니다 (STEP 5 참조)

### 3.5 폴백 블록에 스킬 연결 (중요!)

폴백 블록 = 사용자가 보내는 **모든 메시지**를 받아서 처리하는 블록입니다.

1. 좌측 **시나리오** 메뉴
2. **기본 시나리오** > **폴백 블록** 클릭
3. 하단 **봇 응답** 섹션에서:
   - **스킬데이터 사용** 선택 (또는 "스킬 응답 사용")
   - **파라미터 설정** > **스킬 선택** 드롭다운에서 `MoA AI` 선택
4. **저장**

### 3.6 웰컴 블록 설정 (선택)

사용자가 채널에 처음 들어왔을 때의 인사 메시지를 설정합니다.

1. **시나리오** > **기본 시나리오** > **웰컴 블록** 클릭
2. 봇 응답에 MoA 웰컴 메시지 입력:
   ```
   MoA AI 어시스턴트에 오신 것을 환영합니다!
   궁금한 것을 물어보시거나 "설치"라고 입력하시면 MoA 설치를 안내해드립니다.
   ```
3. 또는 **폴백 블록처럼 스킬 연결** 하면 서버에서 동적 인사 메시지를 보낼 수 있습니다
4. **저장**

> 배포는 STEP 5에서 스킬 URL 입력 후에 진행합니다.

---

## STEP 4: Railway 또는 Vercel에 MoA 배포

### Option A: Railway 배포 (권장)

#### 4A.1 Railway 가입

1. https://railway.app 접속
2. **GitHub 계정으로 로그인** (추천) 또는 이메일 가입
3. Hobby Plan ($5/월) 또는 Pro Plan 선택

#### 4A.2 프로젝트 생성

1. **New Project** 클릭
2. **Deploy from GitHub repo** 선택
3. MoA 저장소 선택 (fork 또는 본인 repo)
4. **Deploy** 클릭

#### 4A.3 빌드 설정

1. 프로젝트 클릭 > **Settings** 탭
2. **Build** 섹션:
   - **Builder**: `Dockerfile`
   - **Dockerfile Path**: `extensions/kakao/Dockerfile`
3. **Deploy** 섹션:
   - **Health Check Path**: `/health`

#### 4A.4 도메인 생성

1. **Settings** > **Networking**
2. **Generate Domain** 클릭
3. 생성된 도메인을 **메모**: `YOUR-APP.up.railway.app`

> 또는 **Custom Domain** 에서 본인 도메인 연결 가능

#### 4A.5 환경변수 입력

1. **Variables** 탭 클릭
2. 아래 **필수 환경변수**를 입력:

```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx
KAKAO_ADMIN_KEY=여기에_REST_API_키_붙여넣기
```

> 나머지 환경변수는 STEP 7에서 추가합니다.

3. **Deploy** 버튼을 눌러 재배포

#### 4A.6 배포 확인

```bash
# Health Check
curl https://YOUR-APP.up.railway.app/health
# 결과: {"status":"ok","kakao":true,...}
```

---

### Option B: Vercel 배포

#### 4B.1 Vercel 설정

Vercel은 서버리스 환경이므로, Railway를 백엔드로 사용하고 Vercel을 프론트엔드/프록시로 사용하는 것을 권장합니다.

**vercel.json** 에 rewrite 설정:
```json
{
  "rewrites": [
    { "source": "/kakao/webhook", "destination": "https://YOUR-APP.up.railway.app/kakao/webhook" },
    { "source": "/install", "destination": "https://YOUR-APP.up.railway.app/install" },
    { "source": "/health", "destination": "https://YOUR-APP.up.railway.app/health" }
  ]
}
```

> Vercel은 서버리스라서 5초 타임아웃 제한이 있을 수 있습니다. 카카오 오픈빌더도 5초 타임아웃이므로 Railway 직접 연결을 권장합니다.

---

## STEP 5: 오픈빌더에 스킬 URL 연결

Railway 배포가 완료되면 스킬 URL을 입력합니다.

### 5.1 스킬 URL 입력

1. https://i.kakao.com > 봇 선택 > **스킬** 메뉴
2. STEP 3.4에서 만든 `MoA AI` 스킬 클릭
3. **URL** 필드에 입력:
   ```
   https://YOUR-APP.up.railway.app/kakao/webhook
   ```
   (YOUR-APP은 Railway에서 생성된 도메인으로 교체)
4. **저장**

### 5.2 스킬 테스트

1. 스킬 설정 페이지 하단의 **스킬 테스트** 버튼 클릭
2. 테스트 메시지 입력: `안녕하세요`
3. 응답이 정상적으로 오는지 확인

### 5.3 봇 배포

1. 좌측 상단 **배포** 버튼 클릭
2. **배포** 확인
3. 배포 완료까지 1~2분 소요

### 5.4 카카오톡에서 테스트

1. 카카오톡 앱 열기
2. **검색** 에서 채널 이름 검색 (예: `MoA AI`)
3. **채널 추가** (친구 추가)
4. 메시지 전송: `안녕하세요`
5. MoA 응답 확인!

---

## STEP 6: NHN Cloud 알림톡/친구톡 설정

알림톡은 사용자에게 카카오톡으로 알림 메시지를 보내는 기능입니다.
친구톡은 채널 친구에게 자유 형식 메시지를 보내는 기능입니다.

> 알림톡/친구톡은 **선택 사항**이지만, MoA의 기기 연결 알림, 원격 명령 결과 알림 등에 사용됩니다.

### 6.1 NHN Cloud 가입

1. https://www.nhncloud.com 접속
2. **회원가입** (카카오/네이버/이메일 계정)
3. **본인 인증** 진행 (필수 — 휴대폰 인증)

### 6.2 프로젝트 생성

1. NHN Cloud 콘솔 로그인
2. **조직 생성** (처음인 경우)
3. **프로젝트 생성** > 프로젝트 이름: `MoA`
4. **확인**

### 6.3 KakaoTalk Bizmessage 서비스 활성화

1. 프로젝트 선택
2. 좌측 메뉴 **서비스 선택** > **Notification**
3. **KakaoTalk Bizmessage** 클릭
4. **서비스 활성화** 확인

### 6.4 본인 인증 (사전등록제)

> 카카오 정책으로 어뷰징 방지를 위해 본인 인증이 필수입니다.

1. KakaoTalk Bizmessage > **본인 인증** 탭
2. **휴대폰 본인 인증** 진행
3. 필요 서류 첨부 (사업자등록증 등)
4. 운영자 검수 대기 (보통 1~2 영업일)
5. 승인 완료 메일 확인

### 6.5 발신 프로필(Sender Key) 등록

1. KakaoTalk Bizmessage > **발신 프로필 관리** 탭
2. **발신 프로필 등록** 클릭
3. **플러스친구 ID** 입력: `@moaai` (STEP 2에서 만든 채널의 검색용 아이디)
4. **관리자 핸드폰 번호** 입력
5. **인증번호 요청** > 카카오톡으로 온 인증번호 입력
6. **등록** 완료

#### 발신 프로필 키(Sender Key) 갈무리

등록 완료 후:
1. 발신 프로필 목록에서 등록한 프로필 확인
2. **발신 키(Sender Key)** 값을 **메모**
   - 이 값이 `KAKAO_SENDER_KEY` 환경변수로 사용됩니다

### 6.6 Appkey / Secret Key 갈무리

1. NHN Cloud 콘솔 > **Notification** > **KakaoTalk Bizmessage**
2. 상단의 **URL & Appkey** 버튼 클릭
3. 다음 값을 **메모**:

| 항목 | 환경변수 | 설명 |
|------|---------|------|
| **Appkey** | `TOAST_APP_KEY` | NHN Cloud 앱 키 |
| **SecretKey** | `TOAST_SECRET_KEY` | NHN Cloud 시크릿 키 |

### 6.7 알림톡 템플릿 등록

알림톡은 **사전에 등록/검수된 템플릿**으로만 발송할 수 있습니다.

#### 6.7.1 템플릿 등록 페이지

1. KakaoTalk Bizmessage > **알림톡** > **템플릿 관리**
2. **템플릿 등록** 클릭

#### 6.7.2 MoA용 추천 템플릿

아래 템플릿들을 등록하세요:

##### 템플릿 1: 기기 연결 완료 알림

| 항목 | 값 |
|------|-----|
| **템플릿 코드** | `moa_device_paired` |
| **템플릿 이름** | MoA 기기 연결 완료 |
| **템플릿 유형** | 텍스트형 |
| **메시지 내용** | 아래 참조 |

```
#{deviceName} 기기가 MoA에 성공적으로 연결되었습니다.

이제 카카오톡에서 바로 기기를 제어할 수 있습니다.

사용 예시:
@#{deviceName} 파일 목록 보여줘
@#{deviceName} 오늘 일정 알려줘

MoA가 항상 대기하고 있습니다!
```

| 버튼 | 타입 | 링크 |
|------|-----|------|
| MoA 사용법 보기 | 웹링크 (WL) | https://mymoa.app/guide |

##### 템플릿 2: 원격 명령 실행 결과

| 항목 | 값 |
|------|-----|
| **템플릿 코드** | `moa_command_result` |
| **템플릿 이름** | MoA 원격 명령 결과 |
| **템플릿 유형** | 텍스트형 |
| **메시지 내용** | 아래 참조 |

```
#{deviceName} 기기의 명령 실행이 완료되었습니다.

명령: #{commandText}
상태: #{status}
결과: #{resultSummary}

카카오톡에서 "/원격결과 #{commandId}"를 입력하여 상세 내용을 확인하세요.
```

##### 템플릿 3: 기기 오프라인 알림

| 항목 | 값 |
|------|-----|
| **템플릿 코드** | `moa_device_offline` |
| **템플릿 이름** | MoA 기기 오프라인 알림 |
| **템플릿 유형** | 텍스트형 |
| **메시지 내용** | 아래 참조 |

```
#{deviceName} 기기와의 연결이 끊어졌습니다.

마지막 연결 시각: #{lastSeenAt}

기기의 인터넷 연결과 MoA 에이전트 실행 상태를 확인해주세요.

카카오톡에서 "/연결상태"를 입력하면 전체 기기 상태를 확인할 수 있습니다.
```

##### 템플릿 4: 보안 알림 (비상정지 등)

| 항목 | 값 |
|------|-----|
| **템플릿 코드** | `moa_security_alert` |
| **템플릿 이름** | MoA 보안 알림 |
| **템플릿 유형** | 텍스트형 |
| **메시지 내용** | 아래 참조 |

```
MoA 보안 알림

#{alertType}: #{alertMessage}

시각: #{timestamp}

즉시 확인이 필요합니다.
카카오톡에서 "사용자 인증" 을 입력하여 본인 확인 후 조치해주세요.
```

| 버튼 | 타입 | 링크 |
|------|-----|------|
| 확인하기 | 웹링크 (WL) | https://mymoa.app/security |

##### 템플릿 5: 채널 가입 안내 (웹사이트 가입자용)

| 항목 | 값 |
|------|-----|
| **템플릿 코드** | `moa_channel_join` |
| **템플릿 이름** | MoA 카카오톡 채널 가입 안내 |
| **템플릿 유형** | 텍스트형 |
| **메시지 내용** | 아래 참조 |

```
#{username}님, MoA 가입을 환영합니다!

카카오톡에서도 MoA를 사용할 수 있습니다.

카카오톡 #{channelName} 채널을 추가하시면:
- 카카오톡에서 바로 AI와 대화
- 기기 원격 제어 명령
- 매일 아침 날씨 알림
- 중요 알림 실시간 수신

아래 버튼을 눌러 채널을 추가해주세요!
```

| 버튼 | 타입 | 링크 |
|------|-----|------|
| 채널 추가하기 | 채널추가 (AC) | (자동) |

##### 템플릿 6: 친구 추천 알림

| 항목 | 값 |
|------|-----|
| **템플릿 코드** | `moa_referral_invite` |
| **템플릿 이름** | MoA 친구 추천 알림 |
| **템플릿 유형** | 텍스트형 |
| **메시지 내용** | 아래 참조 |

```
#{referrerName}님이 MoA를 추천했습니다!

MoA는 카카오톡으로 내 컴퓨터를 원격 제어하고 AI 어시스턴트와 대화할 수 있는 서비스입니다.

지금 가입하시면 추천인과 함께 보너스 크레딧을 받으실 수 있습니다!
```

| 버튼 | 타입 | 링크 |
|------|-----|------|
| MoA 시작하기 | 웹링크 (WL) | https://mymoa.app/install |

#### 6.7.3 템플릿 검수

1. 각 템플릿 등록 후 **검수 요청** 클릭
2. 카카오 검수팀이 영업일 기준 **2일 이내** 처리
3. **승인** 상태가 되면 사용 가능

> **팁**: 템플릿 메시지는 **정보성 메시지**만 가능합니다. 광고 문구가 포함되면 반려됩니다.

### 6.8 최초 사용자 제한 참고

- NHN Cloud는 처음 등록 시 **최초 사용자 제한**이 있습니다
- 템플릿 변수 치환 시 14글자 초과 차이가 나면 발송 실패할 수 있습니다
- 발신 프로필 생성 후 한 달 이내에 10건 이상 정상 발송하면 자동 해제됩니다
- 급한 경우 NHN Cloud 고객센터에 문의하면 수동 해제 가능

---

## STEP 7: Railway/Vercel 환경변수 최종 입력

지금까지 갈무리한 값을 모두 Railway/Vercel 환경변수에 입력합니다.

### Railway: Variables 탭에서 입력

```bash
# ==========================================
# [필수] LLM Provider (최소 1개)
# ==========================================
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxx
# (또는 OPENAI_API_KEY, GOOGLE_API_KEY, GROQ_API_KEY)

# ==========================================
# [필수] 카카오 API 키
# ==========================================
# STEP 1.3에서 복사한 REST API 키
KAKAO_ADMIN_KEY=여기에_REST_API_키_붙여넣기

# STEP 1.3에서 복사한 JavaScript 키 (선택)
KAKAO_APP_KEY=여기에_JavaScript_키_붙여넣기

# ==========================================
# [권장] 카카오톡 채널 정보
# ==========================================
# STEP 2.3에서 확인한 채널 ID
KAKAO_CHANNEL_ID=여기에_채널_ID_붙여넣기

# ==========================================
# [선택] 알림톡/친구톡 (NHN Cloud)
# ==========================================
# STEP 6.5에서 갈무리한 발신 키
KAKAO_SENDER_KEY=여기에_발신_키_붙여넣기

# STEP 6.6에서 갈무리한 NHN Cloud 앱 키
TOAST_APP_KEY=여기에_NHN_Cloud_Appkey_붙여넣기

# STEP 6.6에서 갈무리한 NHN Cloud 시크릿 키
TOAST_SECRET_KEY=여기에_NHN_Cloud_SecretKey_붙여넣기

# ==========================================
# [선택] Supabase (결제/크레딧/기기 관리)
# ==========================================
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...

# ==========================================
# [선택] 추가 설정
# ==========================================
# AI 모델 (기본: claude-3-5-haiku)
# Haiku가 가장 저렴하고 빠릅니다 (카카오 5초 제한에 적합)
MOA_MODEL=claude-3-5-haiku-20241022

# 서버 포트 (Railway가 자동 설정하므로 보통 불필요)
# PORT=8788

# Node 환경
NODE_ENV=production
```

### Vercel: Settings > Environment Variables에서 입력

Vercel을 프록시로 사용하는 경우에도 위 환경변수를 Railway에 입력합니다.
Vercel 자체에는 프록시 설정만 필요합니다.

---

## STEP 8: 배포 및 테스트

### 8.1 Railway 재배포

환경변수를 입력하면 Railway가 **자동으로 재배포**합니다.
수동 재배포: Railway Dashboard > **Deployments** > **Deploy**

### 8.2 Health Check

```bash
curl https://YOUR-APP.up.railway.app/health
```

정상 응답 예시:
```json
{
  "status": "ok",
  "kakao": true,
  "telegram": false,
  "whatsapp": false,
  "discord": false,
  "ownerAuth": false,
  "accounts": 0,
  "skills": 5,
  "eligibleSkills": 3
}
```

### 8.3 카카오톡 테스트

1. 카카오톡 > 채널 검색 > MoA 채널 친구 추가
2. 다음 메시지를 보내서 테스트:

| 테스트 메시지 | 기대 결과 |
|--------------|----------|
| `안녕하세요` | MoA 웰컴 메시지 + 설치 버튼 |
| `설치` | MoA 설치 가이드 + 설치 링크 버튼 |
| `기능 소개` | MoA 기능 안내 |
| `오늘 날씨 알려줘` | AI 응답 (Claude/GPT) |
| `/도움말` | 전체 명령어 목록 |

### 8.4 알림톡 테스트 (설정한 경우)

카카오톡에서 다음을 테스트:

1. `/전화번호 010-1234-5678` → 전화번호 등록
2. `/기기등록` → 페어링 코드 발급
3. 기기에서 페어링 완료 → Friend Talk 알림 수신 확인

---

## 환경변수 전체 목록 및 설명

### 필수

| 변수명 | 어디서 | 설명 |
|--------|-------|------|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com | Claude AI API 키 |
| `KAKAO_ADMIN_KEY` | Kakao Developers > 앱 키 | REST API 키 |

### 카카오 관련

| 변수명 | 어디서 | 설명 |
|--------|-------|------|
| `KAKAO_APP_KEY` | Kakao Developers > 앱 키 | JavaScript 키 (선택) |
| `KAKAO_CHANNEL_ID` | 카카오톡 채널 관리자센터 | 채널 고유 ID |
| `KAKAO_SECRET_KEY` | Kakao Developers > 보안 | 시크릿 키 (선택) |

### NHN Cloud (알림톡/친구톡)

| 변수명 | 어디서 | 설명 |
|--------|-------|------|
| `KAKAO_SENDER_KEY` | NHN Cloud > 발신 프로필 관리 | 발신 프로필 키 |
| `TOAST_APP_KEY` | NHN Cloud > URL & Appkey | 앱 키 |
| `TOAST_SECRET_KEY` | NHN Cloud > URL & Appkey | 시크릿 키 |

### 대체 LLM Provider

| 변수명 | 어디서 | 설명 |
|--------|-------|------|
| `OPENAI_API_KEY` | https://platform.openai.com | OpenAI API 키 |
| `GOOGLE_API_KEY` | Google AI Studio | Gemini API 키 |
| `GROQ_API_KEY` | https://console.groq.com | Groq API 키 |

### 데이터베이스

| 변수명 | 어디서 | 설명 |
|--------|-------|------|
| `SUPABASE_URL` | Supabase Dashboard | 프로젝트 URL |
| `SUPABASE_SERVICE_KEY` | Supabase > Settings > API | 서비스 롤 키 |

### 기타

| 변수명 | 기본값 | 설명 |
|--------|--------|------|
| `MOA_MODEL` | `claude-3-5-haiku-20241022` | 사용할 AI 모델 |
| `PORT` | `8788` | 서버 포트 (Railway 자동 설정) |
| `NODE_ENV` | `production` | 환경 구분 |
| `MOA_OWNER_SECRET` | (없음) | 관리자 인증 시크릿 |

---

## 문제 해결 (트러블슈팅)

### 카카오톡에서 응답이 안 올 때

1. **Health Check 확인**:
   ```bash
   curl https://YOUR-APP.up.railway.app/health
   ```
   `{"status":"ok"}` 이 아니면 Railway 배포 상태 확인

2. **스킬 URL 확인**:
   - 오픈빌더 > 스킬 > URL이 정확한지 확인
   - **반드시 HTTPS**여야 합니다
   - 경로가 `/kakao/webhook` 인지 확인

3. **폴백 블록 확인**:
   - 오픈빌더 > 시나리오 > 폴백 블록에 스킬이 연결되어 있는지 확인

4. **봇 배포 확인**:
   - 스킬 변경 후 반드시 **배포** 버튼 클릭

5. **Railway 로그 확인**:
   ```bash
   # Railway CLI
   railway logs
   ```
   또는 Railway Dashboard > **Deployments** > **Logs**

### 5초 타임아웃 오류

카카오 i 오픈빌더는 **스킬 응답을 5초 이내**에 받아야 합니다.

**해결방법**:
- `MOA_MODEL=claude-3-5-haiku-20241022` (Haiku가 가장 빠름)
- `MOA_MAX_TOKENS=500` (응답 길이 제한)
- Railway 서버의 리전을 **아시아(일본/싱가포르)**로 설정

### 알림톡이 발송되지 않을 때

1. **발신 프로필 상태 확인**:
   - NHN Cloud > 발신 프로필 관리 > 상태가 "정상"인지 확인

2. **템플릿 검수 상태 확인**:
   - NHN Cloud > 알림톡 > 템플릿 관리 > 상태가 "승인"인지 확인

3. **최초 사용자 제한**:
   - 발신 프로필 등록 후 한 달 미만이면 변수 치환 길이 제한이 있습니다
   - 10건 이상 정상 발송하면 자동 해제

4. **환경변수 확인**:
   - `KAKAO_SENDER_KEY`, `TOAST_APP_KEY`, `TOAST_SECRET_KEY` 모두 입력했는지 확인

### "죄송합니다. 메시지 처리 중 오류가 발생했습니다" 메시지

- Railway 로그에서 구체적인 오류 메시지 확인
- 대부분 `ANTHROPIC_API_KEY` 가 잘못되었거나 만료된 경우

---

## 체크리스트

모든 설정이 완료되었는지 확인하세요:

- [ ] Kakao Developers에서 앱 생성 및 REST API 키 갈무리
- [ ] 카카오톡 채널 생성 및 홈 공개 설정
- [ ] 카카오 디벨로퍼스 앱에 채널 연결
- [ ] 카카오 i 오픈빌더에서 봇 생성
- [ ] 오픈빌더에서 봇에 채널 연결
- [ ] 오픈빌더에서 스킬 생성
- [ ] Railway에서 프로젝트 배포
- [ ] Railway 환경변수에 `ANTHROPIC_API_KEY` + `KAKAO_ADMIN_KEY` 입력
- [ ] 오픈빌더 스킬 URL에 Railway 도메인 입력
- [ ] 오픈빌더 폴백 블록에 스킬 연결
- [ ] 오픈빌더에서 봇 배포
- [ ] 카카오톡에서 테스트 메시지 전송 확인
- [ ] (선택) NHN Cloud 가입 및 KakaoTalk Bizmessage 활성화
- [ ] (선택) 발신 프로필 등록 및 Sender Key 갈무리
- [ ] (선택) NHN Cloud Appkey / Secret Key 갈무리
- [ ] (선택) 알림톡 템플릿 등록 및 검수 (6개 템플릿)
- [ ] (선택) Railway 환경변수에 Toast 키 입력
- [ ] (선택) Supabase 스키마 적용 (supabase-engagement-schema.sql)
- [ ] (선택) 날씨 알림 / 공유 기능 테스트

---

## 자동 실행 기능 안내

### 매일 아침 날씨 알림 (7:30 KST)

NHN Cloud Toast 키가 설정되면, 서버가 매일 아침 7:30에 채널 친구들에게 서울 날씨를 보내줍니다.

- **친구톡(FriendTalk)** 으로 발송 (채널 친구에게만)
- 사용자가 `/날씨알림 해제` 로 opt-out 가능
- `/날씨알림 설정` 으로 다시 opt-in 가능

### 채널 가입 유도 (AlimTalk)

MoA 웹사이트에서 가입한 사용자 중 카카오톡 채널 미가입자에게 **알림톡**을 보내 채널 가입을 유도합니다.

- 가입 시 휴대폰 번호를 수집해야 합니다
- `moa_channel_join` 템플릿이 NHN Cloud에 등록/승인되어야 합니다
- 이미 채널 친구인 사용자에게는 발송하지 않습니다

### 친구 초대 (바이럴 공유)

사용자가 카카오톡에서 `친구초대` 를 입력하면 공유용 메시지와 추천 링크를 생성합니다.

- 추천 링크로 가입하면 양쪽에 보너스 크레딧 지급
- Supabase에 referrals 테이블이 필요합니다
- `supabase-engagement-schema.sql` 을 실행하세요

### Supabase 스키마 적용 방법

1. Supabase Dashboard > SQL Editor
2. `supabase-engagement-schema.sql` 파일 내용을 복사하여 실행
3. 새 컬럼들이 `lawcall_users` 테이블에 추가됩니다:
   - `phone_number` — 전화번호 (알림톡 발송용)
   - `is_channel_friend` — 채널 친구 여부
   - `channel_invite_sent_at` — 채널 가입 안내 발송 시각
   - `weather_opt_out` — 날씨 알림 수신 거부
   - `referral_code` — 추천 코드
4. `referrals` 테이블이 생성됩니다 (추천인 관리)
