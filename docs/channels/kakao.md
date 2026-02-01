---
title: "KakaoTalk"
description: "Connect Moltbot to KakaoTalk for messaging in Korea"
---

# KakaoTalk Channel

KakaoTalk is Korea's most popular messaging app. This guide explains how to connect Moltbot to KakaoTalk using **Kakao i Open Builder** for receiving messages and optionally **Friend Talk** for sending proactive messages.

## Overview

The KakaoTalk integration supports two modes:

| Mode | Description | Use Case |
|------|-------------|----------|
| **Kakao i Open Builder** | Skill server that responds to user messages | Chatbot responses |
| **Friend Talk** | Proactive outbound messaging (requires business account) | Notifications, alerts |

## Prerequisites

1. **Kakao Developers Account**: https://developers.kakao.com
2. **Kakao i Open Builder Account**: https://i.kakao.com
3. **Kakao Business Channel** (for Friend Talk)
4. **(Optional) NHN Cloud Toast Account**: For Friend Talk API

## Quick Start

### 1. Set Environment Variables

```bash
export KAKAO_ADMIN_KEY="your-rest-api-key-from-kakao-developers"
export KAKAO_CHANNEL_ID="your-kakao-channel-id"
```

### 2. Configure Moltbot

Add to `~/.moltbot.json`:

```json
{
  "channels": {
    "kakao": {
      "accounts": {
        "default": {
          "enabled": true,
          "webhookPort": 8788,
          "webhookPath": "/kakao/webhook",
          "dmPolicy": "open"
        }
      }
    }
  }
}
```

### 3. Start Moltbot

```bash
moltbot gateway run
```

The webhook server will start on port 8788.

### 4. Configure Kakao i Open Builder

1. Go to https://i.kakao.com
2. Create or select your bot
3. Navigate to **스킬** (Skills) → **스킬 생성** (Create Skill)
4. Enter your webhook URL: `http://your-server:8788/kakao/webhook`
5. Go to **시나리오** (Scenarios) and connect the skill

## Detailed Setup

### Step 1: Create Kakao Developers App

1. Visit https://developers.kakao.com
2. Click **내 애플리케이션** (My Applications)
3. Click **애플리케이션 추가하기** (Add Application)
4. Fill in the app name and create
5. Go to **앱 키** (App Keys) tab
6. Copy the **REST API 키** (REST API Key) - this is your `KAKAO_ADMIN_KEY`

### Step 2: Create Kakao Business Channel

1. Visit https://business.kakao.com
2. Create a new channel for your business
3. Note your **Channel ID**

### Step 3: Set Up Kakao i Open Builder

1. Visit https://i.kakao.com
2. Create a new bot or use existing
3. Link your Kakao Business Channel to the bot

#### Create a Skill

1. Go to **스킬** → **스킬 생성**
2. Fill in:
   - **스킬명**: Moltbot Skill
   - **설명**: Moltbot AI Assistant
   - **URL**: `https://your-domain.com/kakao/webhook`

#### Create a Scenario

1. Go to **시나리오** → **시나리오 생성**
2. Add a **사용자 발화** (User Utterance) block
3. Connect it to your Moltbot skill
4. Deploy the scenario

### Step 4: Expose Webhook (for Development)

If your server isn't publicly accessible, use ngrok:

```bash
ngrok http 8788
```

Then update your Kakao i Open Builder skill URL with the ngrok URL.

## Configuration Options

```json
{
  "channels": {
    "kakao": {
      "accounts": {
        "default": {
          "name": "My Kakao Bot",
          "enabled": true,

          "appKey": "javascript-key",
          "adminKey": "rest-api-key",
          "channelId": "kakao-channel-id",

          "senderKey": "friend-talk-sender-key",
          "toastAppKey": "nhn-toast-app-key",
          "toastSecretKey": "nhn-toast-secret-key",

          "webhookPort": 8788,
          "webhookPath": "/kakao/webhook",

          "dmPolicy": "open",
          "allowFrom": ["user-id-1", "user-id-2"],

          "textChunkLimit": 1000,
          "timeoutSeconds": 30
        }
      }
    }
  }
}
```

### Configuration Fields

| Field | Description | Required |
|-------|-------------|----------|
| `adminKey` | REST API Key from Kakao Developers | Yes |
| `appKey` | JavaScript Key from Kakao Developers | No |
| `channelId` | Kakao Business Channel ID | No |
| `senderKey` | Friend Talk Sender Key | For outbound |
| `toastAppKey` | NHN Cloud Toast App Key | For outbound |
| `toastSecretKey` | NHN Cloud Toast Secret Key | For outbound |
| `webhookPort` | Port for webhook server | No (default: 8788) |
| `webhookPath` | Path for webhook endpoint | No (default: /kakao/webhook) |
| `dmPolicy` | "open", "allowlist", or "disabled" | No (default: open) |
| `allowFrom` | List of allowed user IDs | For allowlist mode |
| `textChunkLimit` | Max characters per message | No (default: 1000) |

## Friend Talk Setup (Outbound Messages)

To send proactive messages to users, you need to set up Friend Talk via NHN Cloud Toast.

### 1. Register Business Profile

1. Go to https://business.kakao.com
2. Register your business
3. Create a Friend Talk profile
4. Get approved (takes 1-3 business days)

### 2. Get NHN Cloud Toast Keys

1. Sign up at https://www.toast.com
2. Create a new project
3. Enable 알림톡/친구톡 service
4. Get your App Key and Secret Key

### 3. Configure Moltbot

```json
{
  "channels": {
    "kakao": {
      "accounts": {
        "default": {
          "senderKey": "your-sender-key",
          "toastAppKey": "your-toast-app-key",
          "toastSecretKey": "your-toast-secret-key"
        }
      }
    }
  }
}
```

### 4. Send Messages

```bash
# Via CLI
moltbot kakao send "+82101234567" "Hello from Moltbot!"

# Via agent tool
# The agent can use the kakao.send gateway method
```

## CLI Commands

```bash
# Check status
moltbot kakao status

# Send a test message (requires Friend Talk)
moltbot kakao send <phone> <message>

# Show setup wizard
moltbot kakao setup
```

## Routing Messages

Configure agent routing for KakaoTalk:

```json
{
  "routing": {
    "bindings": [
      {
        "channel": "kakao",
        "agent": "my-assistant"
      }
    ]
  }
}
```

## Message Format

### Incoming (from Kakao i Open Builder)

```json
{
  "intent": { "id": "...", "name": "..." },
  "userRequest": {
    "utterance": "Hello, how are you?",
    "user": {
      "id": "user-unique-id",
      "type": "botUserKey"
    }
  },
  "bot": { "id": "bot-id", "name": "Bot Name" }
}
```

### Outgoing (Skill Response)

```json
{
  "version": "2.0",
  "template": {
    "outputs": [
      { "simpleText": { "text": "I'm doing great! How can I help?" } }
    ],
    "quickReplies": [
      { "label": "Help", "action": "message", "messageText": "Help" }
    ]
  }
}
```

## Limitations

| Feature | Status |
|---------|--------|
| Receive messages | ✅ Supported |
| Send responses | ✅ Supported |
| Proactive messages | ✅ Requires Friend Talk |
| Images in responses | ⚠️ Limited (via cards) |
| Reactions | ❌ Not supported |
| Threads | ❌ Not supported |
| Edit messages | ❌ Not supported |

## Troubleshooting

### Webhook not receiving messages

1. Ensure your webhook URL is publicly accessible
2. Check that the skill URL in Kakao i Open Builder is correct
3. Verify the scenario is properly connected to the skill

### Friend Talk messages failing

1. Verify your business profile is approved
2. Check that the phone number format is correct (+821012345678)
3. Ensure the recipient has added your channel as a friend

### "Unauthorized" errors

1. Verify your `adminKey` is correct
2. Check that the API key has proper permissions
3. Ensure environment variables are loaded

## Cloud Deployment

For deploying Moltbot + KakaoTalk to the cloud for public users, see the [Cloud Deployment Guide](/channels/kakao-cloud-deploy).

Quick options:
- **Railway**: Easiest, GitHub integration
- **Fly.io**: Free tier available
- **Docker VPS**: Full control

## Example: Complete Configuration

```json
{
  "channels": {
    "kakao": {
      "accounts": {
        "default": {
          "name": "Lawith Assistant",
          "enabled": true,
          "adminKey": "${KAKAO_ADMIN_KEY}",
          "channelId": "${KAKAO_CHANNEL_ID}",
          "senderKey": "${KAKAO_SENDER_KEY}",
          "toastAppKey": "${TOAST_APP_KEY}",
          "toastSecretKey": "${TOAST_SECRET_KEY}",
          "webhookPort": 8788,
          "dmPolicy": "open"
        }
      }
    }
  },
  "routing": {
    "bindings": [
      {
        "channel": "kakao",
        "agent": "lawith-assistant"
      }
    ]
  }
}
```
