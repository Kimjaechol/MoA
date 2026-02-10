---
name: fal-text-to-image
description: Image generation, remix, and editing via fal.ai FLUX and SDXL models.
homepage: https://fal.ai
metadata:
  {
    "openclaw":
      {
        "emoji": "🖼️",
        "requires": { "bins": ["node"] },
        "primaryEnv": "FAL_KEY",
      },
  }
---

# fal Text to Image

Generate, remix, and edit images using fal.ai's FLUX and SDXL models. Specialized for text-to-image workflows with style control and image editing.

## When to use

- Generate images from text descriptions
- Remix or restyle existing images
- Apply style transfers (e.g., "make it look like a watercolor")
- Edit specific parts of an image with inpainting
- Generate variations of an existing image

## Quick start (with API key)

```bash
export FAL_KEY="your-key-here"

# Text to image with FLUX
curl -X POST "https://queue.fal.run/fal-ai/flux/dev" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a professional headshot, studio lighting", "image_size": "square_hd"}'

# Image to image (remix)
curl -X POST "https://queue.fal.run/fal-ai/flux/dev/image-to-image" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "watercolor style", "image_url": "https://example.com/photo.jpg", "strength": 0.7}'
```

## API Key Setup

1. Sign up at https://fal.ai
2. Get your API key from https://fal.ai/dashboard/keys
3. Export: `export FAL_KEY="your-key-here"`

## API Key Benefits

fal.ai API key를 설정하면:

- **FLUX/SDXL 최신 모델** — 최고 품질 이미지 생성
- **이미지 편집** — 인페인팅, 아웃페인팅, 스타일 변환
- **빠른 생성** — GPU 클라우드 기반 수초 내 결과
- **고해상도** — 최대 2048x2048 이미지

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **nano-banana-pro 스킬** — Gemini API로 이미지 생성/편집
2. **Ollama 로컬 모델** — Stable Diffusion 로컬 실행
3. **Hugging Face 무료 추론** — SDXL 등 무료 티어
4. **openai-image-gen 스킬** — OpenAI DALL-E API 활용

```bash
# Hugging Face 무료 추론 API
curl -X POST "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0" \
  -H "Content-Type: application/json" \
  -d '{"inputs": "a professional headshot"}' --output headshot.png
```
