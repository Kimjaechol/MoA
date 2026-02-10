---
name: replicate-api
description: Run AI models (image, video, audio, text) via Replicate's cloud API.
homepage: https://replicate.com
metadata:
  {
    "openclaw":
      {
        "emoji": "🔄",
        "requires": { "bins": ["node"] },
        "primaryEnv": "REPLICATE_API_TOKEN",
      },
  }
---

# Replicate API

Run thousands of AI models via Replicate — image generation, video synthesis, audio processing, LLMs, and more. Pay-per-use cloud inference.

## When to use

- Run any model from Replicate's catalog (SDXL, Llama, Whisper, etc.)
- Generate images, videos, or audio with various AI models
- Process media files (upscale, restore, enhance)
- Run custom fine-tuned models
- Compare outputs across different models

## Quick start (with API key)

```bash
export REPLICATE_API_TOKEN="r8_your_token_here"

# Run SDXL image generation
curl -X POST "https://api.replicate.com/v1/predictions" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version": "stability-ai/sdxl:...", "input": {"prompt": "mountain landscape"}}'

# Check prediction status
curl "https://api.replicate.com/v1/predictions/{id}" \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN"
```

## API Key Setup

1. Sign up at https://replicate.com
2. Go to https://replicate.com/account/api-tokens
3. Create a new token and export:

```bash
export REPLICATE_API_TOKEN="r8_your_token_here"
```

## API Key Benefits

Replicate API token을 설정하면:

- **수천 개 모델** — 이미지, 비디오, 오디오, 텍스트 모델 카탈로그
- **종량제** — 구독 없이 사용한 만큼만 결제
- **커스텀 모델** — 직접 파인튜닝한 모델 배포 가능
- **GPU 클라우드** — A100/H100 GPU 기반 고속 추론
- **API 통합** — REST API로 모든 모델 일관된 방식으로 호출

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **Ollama 로컬 모델** — LLM, 이미지 모델 로컬 실행
2. **Hugging Face 무료 추론** — 무료 티어로 다양한 모델 실행
3. **fal-ai 스킬** — fal.ai 통해 FLUX, Whisper 등 실행
4. **nano-banana-pro 스킬** — Gemini API 이미지 생성

```bash
# Ollama 로컬 모델
ollama run llama3.2 "Summarize this document"
ollama run stable-diffusion "mountain landscape"

# Hugging Face 무료 추론
curl -X POST "https://api-inference.huggingface.co/models/meta-llama/Llama-3.2-1B" \
  -H "Content-Type: application/json" \
  -d '{"inputs": "Summarize this"}'
```
