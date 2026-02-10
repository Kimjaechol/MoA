---
name: soul-guardian
description: "Agent integrity and drift detection. Monitors critical files for unauthorized changes using SHA-256 checksums and behavioral baselines."
homepage: https://docs.openclaw.ai/skills/soul-guardian
metadata:
  {
    "openclaw":
      {
        "emoji": "🛡️",
        "requires": { "bins": ["sha256sum", "bash"] },
      },
  }
---

# Soul Guardian

Detects integrity violations and behavioral drift in your agent setup. Monitors
critical configuration files, skill definitions, and system prompts for unauthorized
changes using SHA-256 checksums. All checks run locally.

## When to use

- "check agent integrity"
- "verify nothing has been tampered with"
- "run soul guardian" / "integrity check"
- "create integrity baseline"
- "has anything changed since last check?"
- After installing or updating skills
- Before and after running untrusted agents or tools
- Periodic security audits of the agent environment

## Quick start

### Create a baseline

Generate SHA-256 checksums of all critical files and save as a baseline:

```bash
GUARDIAN_DIR="$HOME/.openclaw/soul-guardian"
mkdir -p "$GUARDIAN_DIR"

# Checksum all skill definitions
find skills/ -name "SKILL.md" -exec sha256sum {} \; | sort > "$GUARDIAN_DIR/skills.baseline"

# Checksum agent config files
sha256sum ~/.openclaw/config.* ~/.openclaw/settings.* 2>/dev/null | sort > "$GUARDIAN_DIR/config.baseline"

# Checksum system prompt / CLAUDE.md files
find . -name "CLAUDE.md" -o -name "AGENTS.md" -o -name "tools.md" | xargs sha256sum 2>/dev/null | sort > "$GUARDIAN_DIR/prompts.baseline"

echo "Baseline created at $GUARDIAN_DIR"
echo "  Skills: $(wc -l < "$GUARDIAN_DIR/skills.baseline") files"
echo "  Config: $(wc -l < "$GUARDIAN_DIR/config.baseline") files"
echo "  Prompts: $(wc -l < "$GUARDIAN_DIR/prompts.baseline") files"
```

### Verify integrity

Compare current file state against the baseline:

```bash
GUARDIAN_DIR="$HOME/.openclaw/soul-guardian"
DRIFT=0

echo "=== Skill Integrity ==="
find skills/ -name "SKILL.md" -exec sha256sum {} \; | sort > /tmp/skills.current
if diff "$GUARDIAN_DIR/skills.baseline" /tmp/skills.current > /tmp/skills.diff 2>/dev/null; then
  echo "  PASS: All skill files match baseline"
else
  echo "  DRIFT DETECTED in skills:"
  cat /tmp/skills.diff
  DRIFT=1
fi

echo ""
echo "=== Config Integrity ==="
sha256sum ~/.openclaw/config.* ~/.openclaw/settings.* 2>/dev/null | sort > /tmp/config.current
if diff "$GUARDIAN_DIR/config.baseline" /tmp/config.current > /tmp/config.diff 2>/dev/null; then
  echo "  PASS: All config files match baseline"
else
  echo "  DRIFT DETECTED in config:"
  cat /tmp/config.diff
  DRIFT=1
fi

echo ""
echo "=== Prompt Integrity ==="
find . -name "CLAUDE.md" -o -name "AGENTS.md" -o -name "tools.md" | xargs sha256sum 2>/dev/null | sort > /tmp/prompts.current
if diff "$GUARDIAN_DIR/prompts.baseline" /tmp/prompts.current > /tmp/prompts.diff 2>/dev/null; then
  echo "  PASS: All prompt files match baseline"
else
  echo "  DRIFT DETECTED in prompts:"
  cat /tmp/prompts.diff
  DRIFT=1
fi

echo ""
if [ "$DRIFT" -eq 0 ]; then
  echo "ALL CHECKS PASSED -- no drift detected"
else
  echo "WARNING: Drift detected. Review changes above."
fi
```

### Check for new or removed files

```bash
GUARDIAN_DIR="$HOME/.openclaw/soul-guardian"

echo "=== New skill files (not in baseline) ==="
find skills/ -name "SKILL.md" -exec sha256sum {} \; | sort > /tmp/skills.current
comm -13 <(awk '{print $2}' "$GUARDIAN_DIR/skills.baseline") <(awk '{print $2}' /tmp/skills.current)

echo ""
echo "=== Removed skill files (in baseline but missing) ==="
comm -23 <(awk '{print $2}' "$GUARDIAN_DIR/skills.baseline") <(awk '{print $2}' /tmp/skills.current)
```

### Watch mode (continuous monitoring)

```bash
GUARDIAN_DIR="$HOME/.openclaw/soul-guardian"

echo "Watching for changes every 60 seconds... (Ctrl+C to stop)"
while true; do
  find skills/ -name "SKILL.md" -exec sha256sum {} \; | sort > /tmp/skills.current
  if ! diff -q "$GUARDIAN_DIR/skills.baseline" /tmp/skills.current > /dev/null 2>&1; then
    echo "[$(date)] ALERT: Skill file change detected!"
    diff "$GUARDIAN_DIR/skills.baseline" /tmp/skills.current
  fi
  sleep 60
done
```

### Update baseline after verified changes

After reviewing changes and confirming they are legitimate:

```bash
GUARDIAN_DIR="$HOME/.openclaw/soul-guardian"

# Re-generate all baselines
find skills/ -name "SKILL.md" -exec sha256sum {} \; | sort > "$GUARDIAN_DIR/skills.baseline"
sha256sum ~/.openclaw/config.* ~/.openclaw/settings.* 2>/dev/null | sort > "$GUARDIAN_DIR/config.baseline"
find . -name "CLAUDE.md" -o -name "AGENTS.md" -o -name "tools.md" | xargs sha256sum 2>/dev/null | sort > "$GUARDIAN_DIR/prompts.baseline"

echo "Baseline updated at $(date)"
```

## What Soul Guardian monitors

| Category | Files monitored |
|---|---|
| Skills | `skills/*/SKILL.md` -- skill definitions and instructions |
| Config | `~/.openclaw/config.*`, `~/.openclaw/settings.*` |
| Prompts | `CLAUDE.md`, `AGENTS.md`, `tools.md` -- system prompts |
| Binaries | Optional: checksum CLI binaries for tampering |

## Threat model

- **Skill injection**: A malicious skill update modifies SKILL.md to include prompt injection or exfiltration commands.
- **Config tampering**: Unauthorized changes to agent config redirect API calls or disable security features.
- **Prompt drift**: Gradual or sudden changes to system prompts that alter agent behavior.
- **Supply chain**: Third-party skill updates that introduce malicious patterns (pair with `clawdex` for deeper scanning).

## No API Key Required

Soul Guardian runs entirely locally using `sha256sum` and standard Unix tools.
No network access, accounts, or external services needed. Baselines are stored
in `~/.openclaw/soul-guardian/` and are portable across machines.
