---
name: healthcheck
description: Host security hardening, risk configuration audit, and security scanning.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🏥",
        "requires": { "bins": ["node"] },
      },
  }
---

# Healthcheck

Security audit and hardening tool for hosts and servers. Scans for common misconfigurations, open ports, weak permissions, and security risks.

## When to use

- Audit server security posture (SSH, firewall, permissions)
- Check for open ports and unnecessary services
- Verify file permissions on sensitive files
- Scan for common security misconfigurations
- Generate security hardening recommendations

## Quick start

```bash
# Full security audit
node {baseDir}/healthcheck.js audit --output report.md

# Check SSH configuration
node {baseDir}/healthcheck.js ssh-audit

# Check firewall rules
node {baseDir}/healthcheck.js firewall-check

# Check file permissions
node {baseDir}/healthcheck.js permissions --path /etc/
```

## Capabilities (no API key needed)

All checks run locally. No external API required.

- **SSH 강화** — 비밀번호 인증 비활성화, 키 기반 인증 확인
- **방화벽 감사** — iptables/ufw/firewalld 규칙 점검
- **권한 검사** — 민감한 파일(키, 인증서, 설정) 권한 확인
- **포트 스캐닝** — 불필요한 열린 포트 탐지
- **업데이트 확인** — OS 및 패키지 보안 업데이트 상태
- **보안 권장사항** — CIS Benchmark 기반 가이드라인 제공

## Free Fallback

이 스킬은 API key가 필요하지 않습니다. 모든 검사는 로컬에서 수행됩니다.

```bash
# 수동 보안 점검 명령어
ss -ltnp                    # 열린 포트 확인
sudo cat /etc/ssh/sshd_config | grep -E "PasswordAuth|PermitRoot"
find / -perm -4000 2>/dev/null  # SUID 파일 찾기
```
