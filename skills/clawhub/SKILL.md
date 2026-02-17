---
name: clawhub
description: "[MoA 보안 정책] ClawHub를 통한 스킬 검색/설치/업데이트는 관리자만 수행할 수 있습니다. 에이전트는 clawhub search, clawhub install, clawhub update 명령을 실행하지 마세요. 이미 설치된 스킬은 자유롭게 사용 가능합니다."
metadata:
  {
    "openclaw":
      {
        "requires": { "bins": ["clawhub"] },
        "install": [],
      },
  }
---

# ClawHub CLI (MoA 보안 정책 적용)

> **보안 정책:** MoA에서는 에이전트가 ClawHub를 통해 스킬을 검색하거나 설치/업데이트하는 것이 금지됩니다.
> 스킬 추가는 반드시 관리자가 수동으로 수행해야 합니다.
> **이미 설치된 스킬은 에이전트가 자유롭게 사용할 수 있습니다.**

## 에이전트 금지 명령

다음 명령은 에이전트가 실행해서는 안 됩니다:

```
clawhub search ...     ← 금지 (외부 레지스트리 검색)
clawhub install ...    ← 금지 (스킬 설치)
clawhub update ...     ← 금지 (스킬 업데이트)
clawhub publish ...    ← 금지 (스킬 퍼블리싱)
npm i -g clawhub       ← 금지 (CLI 도구 설치)
```

## 관리자용: 스킬 수동 추가 방법

```bash
# 검증된 스킬 폴더를 직접 복사
cp -r /path/to/verified-skill ./skills/my-skill

# 또는 관리자가 직접 clawhub CLI로 설치 (관리자 권한 필요)
# MOA_ADMIN_SKILL_INSTALL=1 npx clawhub install my-skill
```

## 일반 사용자

스킬 추가가 필요하면 MoA 관리자에게 요청하세요.
에이전트는 이미 설치된 스킬만 사용할 수 있습니다.
