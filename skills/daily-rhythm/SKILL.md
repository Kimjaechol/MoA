---
name: daily-rhythm
description: Morning briefing and bedtime routine automation.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🌅",
        "requires": { "bins": ["node"] },
      },
  }
---

# Daily Rhythm

Automated morning briefings and bedtime wind-down routines. Aggregates calendar, weather, tasks, news, and health data into a concise daily summary.

## When to use

- Start the day with a personalized briefing (calendar, weather, top tasks)
- End the day with a review of accomplishments and tomorrow's preview
- Automate recurring daily check-ins without manual prompting
- Combine data from multiple skills into a single digest

## Quick start

### Morning briefing

```bash
node {baseDir}/rhythm.js morning --config ~/.openclaw/daily-rhythm.json
```

Sample output:

```
Good morning! Tuesday, January 14

Weather: 45F, partly cloudy, high of 52F
Calendar: 3 meetings today (first at 9:30am - Sprint Planning)
Tasks: 5 items due today, 2 overdue
Focus suggestion: Block 2-4pm for deep work (no meetings)
```

### Bedtime routine

```bash
node {baseDir}/rhythm.js evening --config ~/.openclaw/daily-rhythm.json
```

Sample output:

```
Day summary: Completed 4/5 tasks, attended 3 meetings
Tomorrow preview: 2 meetings, 3 tasks due
Reminder: Set alarm for 7:00am (first meeting at 9:30)
```

## Configuration

Create `~/.openclaw/daily-rhythm.json`:

```json
{
  "morning": {
    "time": "07:00",
    "modules": ["weather", "calendar", "tasks", "news"],
    "weatherLocation": "San Francisco",
    "newsTopics": ["tech", "AI"],
    "taskSource": "things-mac"
  },
  "evening": {
    "time": "22:00",
    "modules": ["day-review", "tomorrow-preview", "reminder"]
  },
  "delivery": {
    "channel": "telegram",
    "silent": false
  }
}
```

## Modules

| Module            | Source skill  | Description                    |
|-------------------|--------------|--------------------------------|
| weather           | weather      | Current conditions + forecast  |
| calendar          | (system)     | Today's events from Calendar   |
| tasks             | things-mac   | Due and overdue items          |
| news              | (rss/web)    | Headlines from configured feeds|
| day-review        | (internal)   | Summary of completed tasks     |
| tomorrow-preview  | (internal)   | Tomorrow's calendar + tasks    |

## Scheduling

Run via cron or launchd:

```bash
# crontab -e
0 7 * * * node /path/to/skills/daily-rhythm/rhythm.js morning --config ~/.openclaw/daily-rhythm.json
0 22 * * * node /path/to/skills/daily-rhythm/rhythm.js evening --config ~/.openclaw/daily-rhythm.json
```
