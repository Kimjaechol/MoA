# Cloudflare R2 설정 가이드

MoA 데스크톱 앱 설치 파일을 Cloudflare R2에서 배포합니다.
GitHub Releases 대신 R2를 사용하여, 저장소가 private이어도 사용자가 앱을 다운로드할 수 있습니다.

## 왜 R2인가?

- **다운로드 대역폭 무료** (이그레스 비용 0원)
- 저장 비용: $0.015/GB/월 (설치 파일 3개 ~1GB = 약 $0.015/월)
- 커스텀 도메인 연결 가능 (`download.mymoa.app`)

## 1단계: Cloudflare R2 버킷 생성

1. [Cloudflare Dashboard](https://dash.cloudflare.com) 로그인
2. 좌측 메뉴 → **R2 Object Storage** 클릭
3. **Create bucket** 클릭
4. 버킷 이름: `moa-releases`
5. 위치: **Asia Pacific (APAC)** 선택 (한국 사용자 기준 최적)
6. **Create bucket** 클릭

## 2단계: 공개 접근 설정 (Custom Domain)

R2 버킷에 커스텀 도메인을 연결하여 공개 다운로드가 가능하도록 합니다.

1. 생성된 `moa-releases` 버킷 → **Settings** 탭
2. **Public access** 섹션 → **Custom Domains** → **Connect Domain**
3. 도메인 입력: `download.mymoa.app`
4. **Connect domain** 클릭
5. Cloudflare DNS에 CNAME 레코드가 자동 생성됩니다

> 도메인이 이미 Cloudflare DNS에 등록되어 있어야 합니다.
> `mymoa.app` 도메인의 DNS가 Cloudflare를 사용하고 있다면 자동으로 연결됩니다.

## 3단계: R2 API 토큰 생성

CI/CD에서 파일을 업로드하기 위한 API 토큰을 생성합니다.

1. Cloudflare Dashboard → **R2 Object Storage** → **Manage R2 API Tokens**
2. **Create API token** 클릭
3. 설정:
   - Token name: `MoA Release Upload`
   - Permissions: **Object Read & Write**
   - Specify bucket: `moa-releases`
   - TTL: 없음 (영구)
4. **Create API Token** 클릭
5. 표시되는 값을 기록:
   - **Access Key ID**
   - **Secret Access Key**

## 4단계: GitHub Secrets 등록

GitHub 저장소 → Settings → Secrets and variables → Actions:

| Secret 이름 | 값 |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare 계정 ID (Dashboard 우측 상단에서 확인) |
| `R2_ACCESS_KEY_ID` | 3단계에서 생성한 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 3단계에서 생성한 Secret Access Key |
| `R2_BUCKET_NAME` | `moa-releases` |

## 5단계: 수동 업로드 (로컬)

빌드 후 수동으로 업로드하는 방법:

```bash
# 환경변수 설정
export R2_ACCOUNT_ID="your-account-id"
export R2_ACCESS_KEY_ID="your-access-key"
export R2_SECRET_ACCESS_KEY="your-secret-key"
export R2_BUCKET_NAME="moa-releases"

# 전체 플랫폼 업로드
./scripts/upload-r2.sh

# 특정 플랫폼만
./scripts/upload-r2.sh --platform win
./scripts/upload-r2.sh --platform mac
./scripts/upload-r2.sh --platform linux
```

## 6단계: 자동 업로드 (CI/CD)

버전 태그를 push하면 자동으로 빌드 및 R2 업로드가 실행됩니다:

```bash
git tag v2026.2.11
git push origin v2026.2.11
```

워크플로우 파일: `.github/workflows/desktop-release.yml`

## R2 파일 구조

```
moa-releases/
  desktop/
    MoA-Setup-latest.exe          # Windows 설치 파일
    MoA-latest-mac.dmg            # macOS 설치 파일
    MoA-latest-linux.AppImage     # Linux 설치 파일
    latest.yml                    # Windows 자동 업데이트 메타데이터
    latest-mac.yml                # macOS 자동 업데이트 메타데이터
    latest-linux.yml              # Linux 자동 업데이트 메타데이터
```

## 다운로드 URL

커스텀 도메인 설정 후 사용 가능한 URL:

| 플랫폼 | URL |
|---|---|
| Windows | `https://download.mymoa.app/desktop/MoA-Setup-latest.exe` |
| macOS | `https://download.mymoa.app/desktop/MoA-latest-mac.dmg` |
| Linux | `https://download.mymoa.app/desktop/MoA-latest-linux.AppImage` |

## 원클릭 설치 명령어 (변경 없음)

```bash
# macOS / Linux
curl -fsSL https://mymoa.app/install.sh | bash

# Windows
powershell -c "irm https://mymoa.app/install.ps1 | iex"
```

설치 스크립트 내부의 다운로드 URL이 R2를 가리키도록 이미 변경되었습니다.

## 비용 예상

| 항목 | 비용 |
|---|---|
| 저장 (1GB) | ~$0.015/월 |
| 다운로드 대역폭 | **무료** |
| 클래스 A 작업 (업로드, 100건/월) | ~$0.0005 |
| **월간 총 비용** | **약 $0.02 (~30원)** |
