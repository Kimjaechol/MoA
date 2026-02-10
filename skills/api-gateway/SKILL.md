---
name: api-gateway
description: Managed OAuth API integration hub for connecting to third-party services.
homepage: https://oauth.net/2/
metadata:
  {
    "openclaw":
      {
        "emoji": "🔌",
        "requires": { "bins": ["node"] },
      },
  }
---

# API Gateway

A managed OAuth integration hub that handles token refresh, rate limiting, and credential storage for third-party API connections.

## When to use

- Connect to APIs that require OAuth 2.0 (Google, Microsoft, Spotify, etc.)
- Centralize API credentials and token lifecycle management
- Rate-limit outbound requests to avoid hitting provider quotas
- Proxy authenticated requests from agents without exposing raw tokens

## Quick start

1. Initialize the gateway config:

```bash
node {baseDir}/gateway.js init --config ~/.openclaw/api-gateway/config.json
```

2. Register a provider (example: Google):

```bash
node {baseDir}/gateway.js add-provider google \
  --client-id "YOUR_CLIENT_ID" \
  --client-secret "YOUR_CLIENT_SECRET" \
  --scopes "https://www.googleapis.com/auth/calendar.readonly"
```

3. Authenticate (opens browser for OAuth flow):

```bash
node {baseDir}/gateway.js auth google
```

4. Make an authenticated request:

```bash
node {baseDir}/gateway.js request google \
  --url "https://www.googleapis.com/calendar/v3/calendars/primary/events" \
  --method GET
```

## Supported providers

Any OAuth 2.0 provider works. Pre-configured templates exist for:

- **Google** (Calendar, Drive, Gmail, Sheets)
- **Microsoft** (Graph API, OneDrive, Outlook)
- **Spotify** (playback, playlists, library)
- **GitHub** (repos, issues, actions)
- **Slack** (messages, channels)

## Token storage

Tokens are stored encrypted at `~/.openclaw/api-gateway/tokens/`. The encryption key is derived from your system keychain where available, or a local passphrase file.

## Rate limiting

Configure per-provider rate limits in `config.json`:

```json
{
  "providers": {
    "google": {
      "rateLimit": { "requests": 100, "perSeconds": 60 }
    }
  }
}
```

The gateway queues requests that exceed the limit and retries with exponential backoff.
