---
name: gemini-nano-banana-pro-portraits
description: High-quality portrait photo generation templates for Gemini Nano Banana Pro.
homepage: https://ai.google.dev
metadata:
  {
    "openclaw":
      {
        "emoji": "👤",
        "requires": { "bins": ["uv"] },
        "primaryEnv": "GEMINI_API_KEY",
      },
  }
---

# Gemini Nano Banana Pro Portraits

Pre-configured prompt templates for generating high-quality portrait photographs using Gemini Nano Banana Pro (Gemini 3 Pro Image). Optimized for professional headshots, ID photos, and artistic portraits.

## When to use

- Generate professional headshots
- Create ID/passport-style photos
- Produce artistic portrait photography
- Generate character portraits for creative projects

## Quick start (with API key)

```bash
export GEMINI_API_KEY="your-key-here"

# Professional headshot
uv run {baseDir}/../nano-banana-pro/scripts/generate_image.py \
  --prompt "Professional corporate headshot, male, 30s, navy suit, neutral gray background, studio lighting, sharp focus, 85mm lens" \
  --filename "headshot.png" --resolution 2K

# Artistic portrait
uv run {baseDir}/../nano-banana-pro/scripts/generate_image.py \
  --prompt "Cinematic portrait, dramatic side lighting, shallow depth of field, golden hour, natural environment" \
  --filename "artistic-portrait.png" --resolution 2K
```

## Prompt Templates

### Professional Headshots
- `"Professional headshot, [gender], [age range], [attire], neutral background, studio lighting, 85mm lens, sharp focus"`

### ID Photos
- `"Passport photo, front-facing, white background, neutral expression, even lighting, high resolution"`

### Artistic Portraits
- `"Fine art portrait, [style: Rembrandt/butterfly/split] lighting, [mood], [setting], film grain, medium format"`

## API Key Benefits & Free Fallback

`nano-banana-pro` 스킬과 동일한 GEMINI_API_KEY를 사용합니다. API key가 없을 경우 `nano-banana-pro` 스킬의 Free Fallback 섹션을 참조하세요 (Ollama, Hugging Face 무료 모델 등).
