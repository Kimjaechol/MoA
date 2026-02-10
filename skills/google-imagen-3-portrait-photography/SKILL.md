---
name: google-imagen-3-portrait-photography
description: Realistic portrait and art photography with Google Imagen 3.
homepage: https://ai.google.dev
metadata:
  {
    "openclaw":
      {
        "emoji": "📸",
        "requires": { "bins": ["node"] },
        "primaryEnv": "GEMINI_API_KEY",
      },
  }
---

# Google Imagen 3 Portrait Photography

Generate realistic portrait, ID, and artistic photographs using Google Imagen 3. Optimized prompt templates for photorealistic human portraiture.

## When to use

- Generate photorealistic portrait photographs
- Create ID, passport, or professional headshot images
- Produce editorial-style fashion/art photography
- Generate character concepts with realistic human features

## Quick start (with API key)

```bash
export GEMINI_API_KEY="your-key-here"

# Generate via Imagen 3 API
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instances": [{"prompt": "Professional studio portrait, woman, early 30s, business attire, warm lighting"}],
    "parameters": {"sampleCount": 1, "aspectRatio": "3:4"}
  }'
```

## Prompt Templates

### Studio Portrait
- `"Professional studio portrait, [subject], [lighting: Rembrandt/butterfly/loop], [background], high resolution, medium format camera"`

### Environmental Portrait
- `"Environmental portrait, [subject], [location], natural light, shallow depth of field, 50mm prime lens"`

### Editorial/Fashion
- `"Editorial fashion portrait, [subject], [style], dramatic lighting, [mood], magazine quality"`

## API Key Benefits

GEMINI_API_KEY를 설정하면:

- **Imagen 3 품질** — Google의 최신 이미지 생성 모델
- **사실적 인물** — 자연스러운 피부 텍스처, 조명, 표정
- **다양한 비율** — 1:1, 3:4, 4:3, 16:9 등 지원

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **nano-banana-pro 스킬** — Gemini 3 Pro Image로 인물 사진 생성
2. **fal-ai 스킬** — FLUX 모델로 포트레이트 생성
3. **Hugging Face 무료 추론** — 무료 티어 이미지 모델
4. **Ollama 로컬 모델** — Stable Diffusion 로컬 실행
