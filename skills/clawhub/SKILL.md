---
name: clawhub
description: "[DISABLED] ClawHub automatic skill fetching is disabled in MoA for security. Skills must be added manually by an administrator. Contact your MoA admin to request new skills."
metadata:
  {
    "openclaw":
      {
        "disabled": true,
        "requires": { "bins": ["clawhub"] },
        "install": [],
      },
  }
---

# ClawHub CLI (MoA에서 비활성화됨)

> **보안 정책:** MoA에서는 외부 레지스트리에서 스킬을 자동으로 검색하거나 설치하는 기능이 비활성화되어 있습니다.
> 보안상 검증되지 않은 스킬이 설치되는 것을 방지하기 위해, 스킬 추가는 반드시 관리자가 수동으로 수행해야 합니다.

## 관리자용: 스킬 수동 추가 방법

```bash
# 검증된 스킬 폴더를 직접 복사
cp -r /path/to/verified-skill ./skills/my-skill

# 또는 관리자가 직접 clawhub CLI로 설치 (관리자 권한 필요)
# npx clawhub install my-skill
```

## 일반 사용자

스킬 추가가 필요하면 MoA 관리자에게 요청하세요.
에이전트는 이미 설치된 스킬만 사용할 수 있습니다.
