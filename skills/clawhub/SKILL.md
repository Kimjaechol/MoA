---
name: clawhub
description: Use the ClawHub CLI to search, install, update, and publish agent skills from clawhub.com. Use when you need to fetch new skills on the fly, sync installed skills to latest or a specific version, or publish new/updated skill folders with the npm-installed clawhub CLI.
metadata:
  {
    "openclaw":
      {
        "requires": { "bins": ["clawhub"] },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "clawhub",
              "bins": ["clawhub"],
              "label": "Install ClawHub CLI (npm)",
            },
          ],
      },
  }
---

# ClawHub CLI

Install

```bash
npm i -g clawhub
```

Auth (publish)

```bash
clawhub login
clawhub whoami
```

Search

```bash
clawhub search "postgres backups"
```

Install

```bash
clawhub install my-skill
clawhub install my-skill --version 1.2.3
```

Update (hash-based match + upgrade)

```bash
clawhub update my-skill
clawhub update my-skill --version 1.2.3
clawhub update --all
clawhub update my-skill --force
clawhub update --all --no-input --force
```

List

```bash
clawhub list
```

Publish

```bash
clawhub publish ./my-skill --slug my-skill --name "My Skill" --version 1.2.0 --changelog "Fixes + docs"
```

## Auth Benefits

ClawHub에 로그인하면:

- **스킬 퍼블리싱** — 직접 만든 스킬을 커뮤니티에 공유
- **프라이빗 스킬** — 비공개 스킬 설치 및 관리
- **버전 관리** — 스킬 업데이트 이력 추적 및 롤백
- **사용 통계** — 내 스킬의 설치 수, 평가 확인

로그인 없이도 스킬 검색, 설치, 업데이트는 모두 정상 동작합니다.

## Free Fallback (로그인 없이)

로그인하지 않아도 대부분의 기능을 사용할 수 있습니다:

1. **스킬 검색 및 설치** — `clawhub search`, `clawhub install` 모두 인증 불필요
2. **스킬 업데이트** — `clawhub update` 인증 불필요
3. **로컬 스킬 목록** — `clawhub list` 인증 불필요
4. **수동 스킬 설치** — SKILL.md 파일을 직접 `skills/` 디렉토리에 복사

```bash
# 로그인 없이 스킬 검색 및 설치
clawhub search "image generation"
clawhub install nano-banana-pro

# 수동 설치 (인터넷 없어도 가능)
cp -r /path/to/my-skill ./skills/my-skill
```

Notes

- Default registry: https://clawhub.com (override with CLAWHUB_REGISTRY or --registry)
- Default workdir: cwd (falls back to OpenClaw workspace); install dir: ./skills (override with --workdir / --dir / CLAWHUB_WORKDIR)
- Update command hashes local files, resolves matching version, and upgrades to latest unless --version is set
