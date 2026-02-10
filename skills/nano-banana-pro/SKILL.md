---
name: nano-banana-pro
description: Generate or edit images via Gemini 3 Pro Image (Nano Banana Pro).
homepage: https://ai.google.dev/
metadata:
  {
    "openclaw":
      {
        "emoji": "🍌",
        "requires": { "bins": ["uv"], "env": ["GEMINI_API_KEY"] },
        "primaryEnv": "GEMINI_API_KEY",
        "install":
          [
            {
              "id": "uv-brew",
              "kind": "brew",
              "formula": "uv",
              "bins": ["uv"],
              "label": "Install uv (brew)",
            },
          ],
      },
  }
---

# Nano Banana Pro (Gemini 3 Pro Image)

Use the bundled script to generate or edit images.

Generate

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "your image description" --filename "output.png" --resolution 1K
```

Edit (single image)

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "edit instructions" --filename "output.png" -i "/path/in.png" --resolution 2K
```

Multi-image composition (up to 14 images)

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "combine these into one scene" --filename "output.png" -i img1.png -i img2.png -i img3.png
```

API key

- `GEMINI_API_KEY` env var
- Or set `skills."nano-banana-pro".apiKey` / `skills."nano-banana-pro".env.GEMINI_API_KEY` in `~/.openclaw/openclaw.json`

## API Key Benefits

GEMINI_API_KEY를 설정하면:

- **Gemini 3 Pro의 고품질 이미지 생성** — 텍스트 프롬프트에서 사실적 이미지 생성
- **이미지 편집** — 기존 이미지에 프롬프트 기반 수정 적용
- **다중 이미지 합성** — 최대 14장 이미지를 하나로 합성
- **고해상도 출력** — 최대 4K 해상도 지원

API key가 없어도 이미지 생성을 포기하지 않습니다. 아래 무료 대안을 사용합니다.

## Free Fallback (API key 없이)

API key가 없을 경우 다음 대안을 자동으로 사용합니다:

1. **Ollama 로컬 모델** — Stable Diffusion 또는 FLUX 모델을 Ollama로 로컬 실행
2. **openai-image-gen 스킬** — OpenAI API key가 있다면 DALL-E 사용
3. **HTML/SVG 생성** — 간단한 다이어그램이나 차트는 SVG/HTML로 직접 생성
4. **Hugging Face 무료 모델** — Hugging Face Inference API (무료 티어)로 이미지 생성

```bash
# Ollama로 로컬 이미지 생성 (API key 불필요)
ollama run stable-diffusion "a sunset over mountains"

# Hugging Face 무료 추론 API
curl -X POST "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0" \
  -H "Content-Type: application/json" \
  -d '{"inputs": "a sunset over mountains"}' \
  --output output.png
```

Notes

- Resolutions: `1K` (default), `2K`, `4K`.
- Use timestamps in filenames: `yyyy-mm-dd-hh-mm-ss-name.png`.
- The script prints a `MEDIA:` line for OpenClaw to auto-attach on supported chat providers.
- Do not read the image back; report the saved path only.
