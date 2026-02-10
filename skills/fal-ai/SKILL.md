---
name: fal-ai
description: Run AI models (FLUX, SDXL, Whisper, etc.) via fal.ai API for image, video, and audio generation.
homepage: https://fal.ai
metadata:
  {
    "openclaw":
      {
        "emoji": "⚡",
        "requires": { "bins": ["node"] },
        "primaryEnv": "FAL_KEY",
      },
  }
---

# fal.ai

Run cutting-edge AI models via fal.ai — FLUX image generation, SDXL, Whisper transcription, video generation, and more. Pay-per-use with no subscription.

## When to use

- Generate images with FLUX or SDXL models
- Transcribe audio with Whisper
- Generate videos with AI models
- Run any model from the fal.ai catalog
- Batch process media files

## Quick start (with API key)

```bash
export FAL_KEY="your-key-here"

# Generate image with FLUX
curl -X POST "https://queue.fal.run/fal-ai/flux/dev" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a serene mountain landscape at sunset", "image_size": "landscape_16_9"}'

# Transcribe audio with Whisper
curl -X POST "https://queue.fal.run/fal-ai/whisper" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"audio_url": "https://example.com/audio.mp3"}'
```

## API Key Setup

1. Sign up at https://fal.ai
2. Get your API key from https://fal.ai/dashboard/keys
3. Export it:

```bash
export FAL_KEY="your-key-here"
```

## API Key Benefits

fal.ai API key를 설정하면:

- **최신 AI 모델** — FLUX, SDXL, Whisper, Stable Video 등
- **종량제** — 구독 없이 사용한 만큼만 결제
- **빠른 추론** — GPU 클라우드 기반 고속 처리
- **배치 처리** — 다수 파일 한번에 처리

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **Ollama 로컬 모델** — Stable Diffusion 등 로컬 이미지 생성
2. **openai-whisper 스킬** — 로컬 Whisper로 음성 변환 (API key 불필요)
3. **nano-banana-pro 스킬** — Gemini API로 이미지 생성
4. **Hugging Face 무료 추론** — 무료 티어로 모델 실행

```bash
# 로컬 Whisper (API key 불필요)
whisper audio.mp3 --model base --output_format txt

# Ollama 로컬 이미지 모델
ollama run stable-diffusion "mountain landscape"
```
