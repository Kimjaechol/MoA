# mymoa.app DNS 설정 가이드

`mymoa.app` 도메인의 DNS 레코드 설정 가이드입니다.

## 도메인 구조

| 서브도메인 | 용도 | 연결 서비스 |
|---|---|---|
| `mymoa.app` | 메인 웹앱 | Vercel |
| `download.mymoa.app` | 앱 설치 파일 다운로드 | Cloudflare R2 |
| `api.mymoa.app` | 백엔드 API (예비) | Railway |

## 사전 요구사항

`.app` 도메인은 HSTS가 기본 적용되어 **HTTPS만 허용**됩니다.
Vercel, Cloudflare R2, Railway 모두 HTTPS를 자동 지원하므로 문제 없습니다.

## 1단계: Cloudflare에 도메인 추가

1. [Cloudflare Dashboard](https://dash.cloudflare.com) 접속
2. **Add a site** 클릭 → `mymoa.app` 입력
3. **Free** 플랜 선택
4. Cloudflare가 제공하는 네임서버 2개를 도메인 등록기관에 설정:
   ```
   예: ns1.cloudflare.com, ns2.cloudflare.com
   ```
5. 도메인 등록기관(예: Google Domains, Namecheap 등)에서 네임서버 변경
6. Cloudflare에서 네임서버 전파 확인 (최대 24시간, 보통 수분 내)

## 2단계: Vercel에 커스텀 도메인 연결 (mymoa.app)

1. [Vercel Dashboard](https://vercel.com) → 프로젝트 선택
2. **Settings** → **Domains** → **Add**
3. `mymoa.app` 입력 → **Add**
4. Vercel이 알려주는 DNS 레코드를 Cloudflare에 추가:

### Cloudflare DNS 레코드

```
Type: CNAME
Name: @
Target: cname.vercel-dns.com
Proxy: OFF (DNS only, 회색 구름)
```

> Vercel은 Cloudflare 프록시(주황색 구름)와 호환되지 않으므로
> 반드시 **프록시 꺼짐 (DNS only)** 상태로 설정해야 합니다.

`www.mymoa.app`도 추가하려면:
```
Type: CNAME
Name: www
Target: cname.vercel-dns.com
Proxy: OFF
```

## 3단계: Cloudflare R2에 커스텀 도메인 연결 (download.mymoa.app)

1. Cloudflare Dashboard → **R2 Object Storage** → `moa-releases` 버킷
2. **Settings** → **Public access** → **Custom Domains** → **Connect Domain**
3. `download.mymoa.app` 입력 → **Connect domain**
4. Cloudflare가 자동으로 CNAME 레코드를 추가합니다

```
Type: CNAME
Name: download
Target: (R2가 자동 생성)
Proxy: ON (주황색 구름 — R2는 프록시 필요)
```

## 4단계: Railway 커스텀 도메인 연결 (api.mymoa.app — 선택사항)

현재 Railway 백엔드는 Vercel의 rewrites를 통해 프록시되므로,
별도의 `api.mymoa.app` 설정은 선택사항입니다.

필요한 경우:
1. Railway Dashboard → 프로젝트 → **Settings** → **Networking** → **Custom Domains**
2. `api.mymoa.app` 추가
3. Railway가 제공하는 CNAME 값을 Cloudflare에 추가:

```
Type: CNAME
Name: api
Target: (Railway가 제공하는 값)
Proxy: OFF
```

## 5단계: SSL 인증서 확인

- **Vercel**: 커스텀 도메인 추가 시 자동으로 Let's Encrypt SSL 발급
- **Cloudflare R2**: Cloudflare Universal SSL 자동 적용
- **Railway**: 커스텀 도메인 추가 시 자동 SSL 발급

## DNS 레코드 최종 요약

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `@` | `cname.vercel-dns.com` | OFF |
| CNAME | `www` | `cname.vercel-dns.com` | OFF |
| CNAME | `download` | (R2 자동 생성) | ON |
| CNAME | `api` | (Railway 제공값, 선택) | OFF |

## 6단계: Vercel 환경변수 업데이트

Vercel 프로젝트의 환경변수에서 다음 값을 업데이트합니다:

```
NEXT_PUBLIC_API_URL=https://mymoa.app
```

## 7단계: 외부 서비스 웹훅 URL 업데이트

다음 외부 서비스의 웹훅 URL을 새 도메인으로 변경합니다:

| 서비스 | 기존 URL | 새 URL |
|---|---|---|
| 카카오 웹훅 | `https://moa.lawith.kr/kakao/webhook` | `https://mymoa.app/kakao/webhook` |
| 텔레그램 웹훅 | `https://moa.lawith.kr/telegram/webhook` | `https://mymoa.app/telegram/webhook` |
| WhatsApp 웹훅 | `https://moa.lawith.kr/whatsapp/webhook` | `https://mymoa.app/whatsapp/webhook` |
| Discord 웹훅 | `https://moa.lawith.kr/discord/webhook` | `https://mymoa.app/discord/webhook` |
| PortOne 결제 | `https://moa.lawith.kr/api/payment/webhook` | `https://mymoa.app/api/payment/webhook` |

## 전환 체크리스트

- [ ] Cloudflare 네임서버 설정
- [ ] Vercel 커스텀 도메인 (`mymoa.app`) 연결
- [ ] Cloudflare R2 커스텀 도메인 (`download.mymoa.app`) 연결
- [ ] Vercel 환경변수 `NEXT_PUBLIC_API_URL` 업데이트
- [ ] 카카오 웹훅 URL 업데이트
- [ ] 텔레그램 Bot 웹훅 URL 업데이트
- [ ] WhatsApp 웹훅 URL 업데이트
- [ ] PortOne 결제 웹훅 URL 업데이트
- [ ] GitHub Secrets에 R2 키 등록
- [ ] 기존 `moa.lawith.kr` → `mymoa.app` 301 리다이렉트 설정 (선택)
