---
name: slack-api
description: Advanced Slack workspace automation via Slack API — channels, users, messages, and workflows.
homepage: https://api.slack.com
metadata:
  {
    "openclaw":
      {
        "emoji": "💬",
        "requires": { "bins": ["node"] },
        "primaryEnv": "SLACK_BOT_TOKEN",
      },
  }
---

# Slack API

Advanced Slack workspace automation — channel management, user lookup, message threading, file uploads, and workflow triggers via the Slack Web API.

## When to use

- Manage Slack channels (create, archive, invite members)
- Search messages across workspace
- Upload files and share with channels
- Look up user profiles and status
- Build automated workflows with message formatting (Block Kit)
- Post rich messages with attachments, buttons, and menus

## Quick start (with API key)

```bash
export SLACK_BOT_TOKEN="xoxb-your-token-here"

# Post a message
curl -X POST "https://slack.com/api/chat.postMessage" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channel": "C0123456789", "text": "Hello from MoA!"}'

# List channels
curl "https://slack.com/api/conversations.list" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"

# Search messages
curl "https://slack.com/api/search.messages?query=project+update" \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN"
```

## API Key Setup

1. Go to https://api.slack.com/apps → Create New App
2. Add Bot Token Scopes (channels:read, chat:write, users:read, files:write, search:read)
3. Install to workspace and copy the Bot User OAuth Token
4. Export it:

```bash
export SLACK_BOT_TOKEN="xoxb-your-token-here"
```

## API Key Benefits

Slack Bot Token을 설정하면:

- **채널 관리** — 채널 생성, 아카이브, 멤버 초대/제거
- **메시지 검색** — 워크스페이스 전체 메시지 검색
- **파일 공유** — 파일 업로드 및 채널 공유
- **사용자 조회** — 프로필, 상태, 이메일 조회
- **리치 메시지** — Block Kit으로 버튼, 메뉴, 첨부파일 포함 메시지 전송

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **기존 slack 스킬** — 기본 메시지 전송/리액션/핀 관리는 `slack` 스킬로 가능
2. **Webhook** — Incoming Webhook URL로 메시지 전송 (봇 토큰 불필요)
3. **로컬 알림** — 터미널 알림 또는 로컬 파일로 메시지 저장

```bash
# Webhook으로 메시지 전송 (봇 토큰 불필요)
curl -X POST "https://hooks.slack.com/services/T.../B.../xxx" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from MoA!"}'
```
