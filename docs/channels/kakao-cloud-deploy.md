---
title: "KakaoTalk Cloud Deployment"
description: "Deploy Moltbot with KakaoTalk for public users"
---

# KakaoTalk Cloud Deployment Guide

이 가이드는 Moltbot + KakaoTalk을 클라우드에 배포하여 일반 사용자들이 카카오 채널 추가만으로 AI 챗봇을 사용할 수 있게 하는 방법을 설명합니다.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User Phone    │────▶│  KakaoTalk App   │────▶│  Kakao Server   │
│  (KakaoTalk)    │     │                  │     │  (i.kakao.com)  │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          │ Webhook
                                                          ▼
                        ┌──────────────────────────────────────────┐
                        │         Cloud Platform                    │
                        │  (Railway / Fly.io / AWS / etc.)         │
                        │  ┌────────────────────────────────────┐  │
                        │  │           Moltbot Gateway          │  │
                        │  │  ┌──────────┐    ┌──────────────┐  │  │
                        │  │  │  Kakao   │    │    Agent     │  │  │
                        │  │  │  Plugin  │───▶│   (Claude)   │  │  │
                        │  │  └──────────┘    └──────────────┘  │  │
                        │  └────────────────────────────────────┘  │
                        └──────────────────────────────────────────┘
```

## Deployment Options

| Platform | Cost | Difficulty | Best For |
|----------|------|------------|----------|
| **Railway** | $5/month~ | Easy | Quick deployment |
| **Fly.io** | Free tier available | Medium | Production |
| **AWS ECS** | Pay-per-use | Advanced | Enterprise |
| **Docker VPS** | $5/month~ | Medium | Full control |

## Option 1: Railway Deployment (Recommended)

Railway는 GitHub 연동으로 쉽게 배포할 수 있습니다.

### Step 1: Fork Repository

```bash
# Fork moltbot repository to your GitHub account
# or clone and push to your own repo
git clone https://github.com/moltbot/moltbot.git
cd moltbot
git remote add myorigin https://github.com/YOUR_USERNAME/moltbot.git
git push myorigin main
```

### Step 2: Create Railway Project

1. https://railway.app 방문
2. **New Project** → **Deploy from GitHub Repo**
3. moltbot 레포지토리 선택
4. **Settings** → **Build Command**: 비워두기 (Dockerfile 사용)
5. **Root Directory**: `.` (루트)

### Step 3: Configure Environment Variables

Railway dashboard에서 **Variables** 탭:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-xxxxx
KAKAO_ADMIN_KEY=your_kakao_admin_key

# Optional
KAKAO_CHANNEL_ID=your_channel_id
KAKAO_SENDER_KEY=sender_key_for_friend_talk
TOAST_APP_KEY=toast_app_key
TOAST_SECRET_KEY=toast_secret_key
```

### Step 4: Deploy

1. Railway 자동 빌드 대기
2. **Settings** → **Networking** → **Generate Domain**
3. 생성된 URL 복사 (예: `moltbot-kakao.up.railway.app`)

### Step 5: Configure Kakao i Open Builder

1. https://i.kakao.com 접속
2. 스킬 URL에 Railway URL 입력:
   ```
   https://moltbot-kakao.up.railway.app/kakao/webhook
   ```
3. 시나리오에 스킬 연결

## Option 2: Fly.io Deployment

Fly.io는 무료 티어가 있어 테스트에 적합합니다.

### Step 1: Install Fly CLI

```bash
# macOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh

# Windows
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

### Step 2: Login and Deploy

```bash
cd moltbot

# Login (create account if needed)
flyctl auth login

# Launch app
flyctl launch --config extensions/kakao/fly.toml

# Set secrets
flyctl secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
flyctl secrets set KAKAO_ADMIN_KEY=your_admin_key

# Create volume for persistent data
flyctl volumes create moltbot_data --size 1

# Deploy
flyctl deploy
```

### Step 3: Get Public URL

```bash
flyctl info
# Output: moltbot-kakao.fly.dev
```

## Option 3: Docker VPS Deployment

VPS (Vultr, DigitalOcean, etc.)에 직접 배포:

### Step 1: Provision Server

```bash
# SSH into your VPS
ssh root@your-server-ip

# Install Docker
curl -fsSL https://get.docker.com | sh
```

### Step 2: Clone and Configure

```bash
git clone https://github.com/moltbot/moltbot.git
cd moltbot/extensions/kakao

# Copy and edit environment file
cp .env.example .env
nano .env
```

### Step 3: Run with Docker Compose

```bash
docker-compose up -d

# Check logs
docker-compose logs -f
```

### Step 4: Set Up Reverse Proxy (Optional but Recommended)

```bash
# Install nginx
apt install nginx certbot python3-certbot-nginx

# Configure nginx
cat > /etc/nginx/sites-available/moltbot << 'EOF'
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8788;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -s /etc/nginx/sites-available/moltbot /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get SSL certificate
certbot --nginx -d your-domain.com
```

## User Onboarding Flow

클라우드 배포 후, 사용자들은 다음과 같이 사용합니다:

### For End Users (일반 사용자)

1. **카카오톡에서 채널 검색**
   - 카카오톡 → 검색 → "Lawith" (또는 서비스명)

2. **채널 추가**
   - "채널 추가" 버튼 클릭

3. **대화 시작**
   - 채널 채팅방에서 메시지 전송
   - AI가 자동 응답

### Landing Page Example

사용자 안내를 위한 랜딩페이지 예시:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <title>Lawith AI Assistant</title>
</head>
<body>
    <h1>Lawith AI 법률 상담</h1>
    <p>카카오톡에서 간편하게 법률 상담을 받으세요.</p>

    <h2>사용 방법</h2>
    <ol>
        <li>카카오톡에서 "Lawith" 검색</li>
        <li>채널 추가 클릭</li>
        <li>채팅방에서 질문하세요!</li>
    </ol>

    <a href="https://pf.kakao.com/_YOUR_CHANNEL_ID">
        <img src="kakao-channel-button.png" alt="카카오톡 채널 추가">
    </a>
</body>
</html>
```

## Multi-Tenant Configuration

여러 서비스(Lawith, AI Secretary 등)를 하나의 인스턴스로 운영:

```json
{
  "channels": {
    "kakao": {
      "accounts": {
        "lawith": {
          "enabled": true,
          "name": "Lawith 법률 상담",
          "adminKey": "${LAWITH_KAKAO_ADMIN_KEY}",
          "webhookPath": "/kakao/lawith"
        },
        "secretary": {
          "enabled": true,
          "name": "AI 전화비서",
          "adminKey": "${SECRETARY_KAKAO_ADMIN_KEY}",
          "webhookPath": "/kakao/secretary"
        }
      }
    }
  },
  "routing": {
    "bindings": [
      { "channel": "kakao", "accountId": "lawith", "agent": "lawith-agent" },
      { "channel": "kakao", "accountId": "secretary", "agent": "secretary-agent" }
    ]
  },
  "agents": {
    "lawith-agent": {
      "provider": "anthropic",
      "model": "claude-opus-4-5-20251101",
      "systemPrompt": "당신은 한국 법률 전문 AI 상담사입니다..."
    },
    "secretary-agent": {
      "provider": "anthropic",
      "model": "claude-opus-4-5-20251101",
      "systemPrompt": "당신은 AI 전화비서입니다..."
    }
  }
}
```

## Monitoring & Maintenance

### Health Check

```bash
curl https://your-domain.com/health
# Expected: ok
```

### Logs

```bash
# Railway
railway logs

# Fly.io
flyctl logs

# Docker
docker-compose logs -f moltbot-kakao
```

### Scaling

```bash
# Fly.io - add more instances
flyctl scale count 2

# Railway - auto-scales based on load
```

## Cost Estimation

| Service | Monthly Cost | Notes |
|---------|--------------|-------|
| **Railway Starter** | ~$5-20 | Based on usage |
| **Fly.io Free Tier** | $0 | 3 shared VMs, limited hours |
| **Fly.io Production** | ~$10-30 | 1GB RAM, always-on |
| **Claude API** | Variable | ~$0.003/message avg |
| **Kakao API** | Free | Skill server is free |
| **Friend Talk** | ~15원/message | For proactive messages |

## Security Checklist

- [ ] HTTPS enabled (required for Kakao webhook)
- [ ] API keys stored as secrets (not in code)
- [ ] Rate limiting configured
- [ ] DM policy set appropriately
- [ ] Logging enabled for audit trail
- [ ] Backup strategy for persistent data

## Troubleshooting

### Webhook timeout

Kakao i Open Builder는 5초 타임아웃이 있습니다. 응답이 느리면:

1. 모델을 빠른 것으로 변경 (claude-3-haiku)
2. 응답 캐싱 구현
3. 프리페칭 로직 추가

### Messages not delivered

1. 웹훅 URL이 HTTPS인지 확인
2. Kakao i Open Builder 스킬 URL 확인
3. 시나리오가 스킬에 연결되어 있는지 확인

### Rate limiting

트래픽이 많으면:

1. 인스턴스 수 늘리기
2. Redis 캐시 추가
3. 응답 큐잉 구현

## Next Steps

- [Friend Talk 설정](/channels/kakao#friend-talk-setup)
- [Agent 커스터마이징](/agents/configuration)
- [Tool 통합](/tools/overview)
