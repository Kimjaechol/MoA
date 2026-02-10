---
name: self-improving-agent
description: "Auto-captures errors, corrections, and successful patterns to build a persistent learning memory that improves agent responses over time."
homepage: https://docs.openclaw.ai/skills/self-improving-agent
metadata:
  {
    "openclaw":
      {
        "emoji": "🧠",
        "requires": { "bins": ["bash"] },
      },
  }
---

# Self-Improving Agent

Automatically captures errors, user corrections, and successful strategies into a
persistent learning store. The agent consults past learnings to avoid repeating
mistakes and to apply proven approaches. All data stays local.

## When to use

- "learn from this mistake"
- "remember this for next time"
- "what have you learned so far?"
- "show me your learnings"
- "forget the learning about ..."
- Automatically after errors or user corrections (passive capture)
- When the agent notices a pattern worth remembering

## How it works

1. **Error capture**: When a command fails or the user corrects the agent, a learning
   entry is written with the context, the mistake, and the fix.
2. **Pattern capture**: When a multi-step task succeeds, the agent records the
   successful approach for similar future tasks.
3. **Recall**: Before acting on a task, the agent checks `~/.openclaw/learnings/`
   for relevant past entries and adjusts its approach.
4. **Pruning**: Old or low-value entries can be reviewed and removed.

## Quick start

### Record a learning manually

```bash
mkdir -p ~/.openclaw/learnings
cat >> ~/.openclaw/learnings/corrections.jsonl << 'ENTRY'
{"ts":"2025-01-15T10:30:00Z","type":"correction","context":"git rebase","mistake":"Used --force without checking upstream","fix":"Always run git fetch and check divergence before force-push","confidence":0.9}
ENTRY
echo "Learning recorded."
```

### Record an error pattern

```bash
cat >> ~/.openclaw/learnings/errors.jsonl << 'ENTRY'
{"ts":"2025-01-15T11:00:00Z","type":"error","command":"pip install torch","error":"No space left on device","resolution":"Clean pip cache with pip cache purge before large installs","confidence":0.8}
ENTRY
```

### Record a successful strategy

```bash
cat >> ~/.openclaw/learnings/strategies.jsonl << 'ENTRY'
{"ts":"2025-01-15T12:00:00Z","type":"strategy","task":"deploy to production","steps":["run tests","build docker image","push to registry","update k8s manifest","verify health check"],"outcome":"success","confidence":0.95}
ENTRY
```

### Search learnings

```bash
# Find all learnings about git
grep -i "git" ~/.openclaw/learnings/*.jsonl | python3 -m json.tool

# Count learnings by type
for f in ~/.openclaw/learnings/*.jsonl; do
  echo "$(basename "$f"): $(wc -l < "$f") entries"
done

# Find high-confidence learnings
python3 -c "
import json, glob
for f in glob.glob('$HOME/.openclaw/learnings/*.jsonl'):
    for line in open(f):
        entry = json.loads(line)
        if entry.get('confidence', 0) >= 0.9:
            print(f\"{entry['type']}: {entry.get('fix') or entry.get('task', 'N/A')}\")
"
```

### Show recent learnings

```bash
tail -20 ~/.openclaw/learnings/*.jsonl | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line or line.startswith('==>'):
        continue
    try:
        e = json.loads(line)
        print(f\"[{e.get('type','?')}] {e.get('fix') or e.get('task') or e.get('context','')}\")
    except json.JSONDecodeError:
        pass
"
```

### Prune old or low-confidence entries

```bash
python3 -c "
import json, glob, os
for f in glob.glob('$HOME/.openclaw/learnings/*.jsonl'):
    entries = [json.loads(l) for l in open(f) if l.strip()]
    kept = [e for e in entries if e.get('confidence', 0.5) >= 0.5]
    removed = len(entries) - len(kept)
    if removed:
        with open(f, 'w') as out:
            for e in kept:
                out.write(json.dumps(e) + '\n')
        print(f'{os.path.basename(f)}: removed {removed} low-confidence entries')
    else:
        print(f'{os.path.basename(f)}: all entries OK')
"
```

## Storage format

All learnings are stored as JSONL files in `~/.openclaw/learnings/`:

| File | Contents |
|---|---|
| `corrections.jsonl` | User corrections and agent mistakes |
| `errors.jsonl` | Command/tool errors and their resolutions |
| `strategies.jsonl` | Successful multi-step approaches |

Each line is a JSON object with at minimum: `ts`, `type`, `confidence` (0.0-1.0).

## No API Key Required

Everything runs locally and writes to `~/.openclaw/learnings/`. No network
access, accounts, or external services needed. Learnings persist across sessions
and are portable (copy the directory to another machine).
