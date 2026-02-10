---
name: clawdex
description: "Security scanner for ClawHub skills. Audits SKILL.md files, tool definitions, and bundled scripts for supply-chain risks."
homepage: https://clawhub.com/security
metadata:
  {
    "openclaw":
      {
        "emoji": "🔍",
        "requires": { "bins": ["bash", "sha256sum"] },
      },
  }
---

# Clawdex -- ClawHub Skill Security Scanner

Scans locally installed skills for supply-chain risks, suspicious patterns, and
policy violations. Runs entirely offline -- no API key required.

## When to use

- "scan my skills for security issues"
- "audit this skill before I install it"
- "check skills for suspicious commands"
- "run clawdex" / "security scan"
- Before installing a new third-party skill from ClawHub
- After updating skills to verify nothing malicious changed

## Quick start

### Scan all installed skills

```bash
# Scan every skill directory for risky patterns
for dir in skills/*/; do
  echo "=== Scanning $dir ==="
  # Check for dangerous shell patterns
  grep -rn 'curl.*| *sh\|wget.*| *bash\|eval\|exec(\|child_process\|rm -rf /\|chmod 777\|nc -e\|/dev/tcp' "$dir" || echo "  CLEAN"
  echo ""
done
```

### Scan a single skill

```bash
SKILL_DIR="skills/some-skill"
echo "--- File inventory ---"
find "$SKILL_DIR" -type f | head -50
echo ""
echo "--- Suspicious patterns ---"
grep -rn 'curl.*| *sh\|eval\|exec(\|child_process\|rm -rf\|chmod 777\|nc -e\|/dev/tcp\|base64 -d\|python -c' "$SKILL_DIR" || echo "CLEAN: no suspicious patterns found"
echo ""
echo "--- Network calls ---"
grep -rn 'curl \|wget \|fetch(\|http://\|https://' "$SKILL_DIR" || echo "No network calls found"
echo ""
echo "--- File writes ---"
grep -rn 'writeFile\|> /\|>> /\|tee \|mktemp\|/tmp/' "$SKILL_DIR" || echo "No file write operations found"
```

### Verify file integrity

```bash
# Generate checksums for a skill directory (save as baseline)
find skills/some-skill -type f -exec sha256sum {} \; | sort > /tmp/skill-checksums.txt

# Later, verify nothing changed
find skills/some-skill -type f -exec sha256sum {} \; | sort | diff /tmp/skill-checksums.txt - || echo "FILES CHANGED"
```

## What Clawdex checks

| Category | Patterns detected |
|---|---|
| Code injection | `eval`, `exec()`, `child_process`, `Function()` |
| Network exfil | Piped curl/wget to shell, raw `/dev/tcp` |
| Destructive ops | `rm -rf /`, `chmod 777`, recursive deletes |
| Data exfil | Base64 encoding + network calls, `/tmp` staging |
| Obfuscation | Base64-decoded eval, hex-encoded payloads |
| Scope creep | File writes outside skill dir, env var reads |

## Policy recommendations

- Review every skill's SKILL.md and any bundled `.sh`/`.py`/`.ts` scripts before installing.
- Pin skill versions with `clawhub install skill --version X.Y.Z`.
- Re-scan after every `clawhub update`.
- Store baseline checksums and compare after updates.
- Prefer skills with source links to public repositories.

## No API Key Required

Clawdex runs entirely locally using standard Unix tools (`grep`, `find`, `sha256sum`).
No network access, accounts, or API keys needed.
