---
name: sora-2-nature-documentary
description: Nature documentary-style video generation with OpenAI Sora 2.
homepage: https://openai.com/sora
metadata:
  {
    "openclaw":
      {
        "emoji": "🎥",
        "requires": { "bins": ["node"] },
        "primaryEnv": "OPENAI_API_KEY",
      },
  }
---

# Sora 2 Nature Documentary

Generate nature documentary-style videos using OpenAI Sora 2. Prompt templates optimized for wildlife, landscape, and natural phenomenon cinematography.

## When to use

- Generate nature documentary-style video clips
- Create wildlife footage with cinematic quality
- Produce landscape and aerial nature shots
- Generate educational nature content

## Quick start (with API key)

```bash
export OPENAI_API_KEY="your-key-here"

# Generate nature documentary clip
curl -X POST "https://api.openai.com/v1/videos/generations" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sora-2",
    "prompt": "Cinematic nature documentary shot: a majestic eagle soaring over snow-capped mountains at golden hour, shot from a drone, David Attenborough narration style, 4K quality",
    "duration": 10,
    "resolution": "1080p"
  }'
```

## Prompt Templates

### Wildlife
- `"Nature documentary: [animal] in its natural habitat, [behavior], telephoto lens, shallow depth of field, golden hour lighting, BBC Earth style"`

### Landscape
- `"Aerial cinematic shot: [landscape type], drone footage, sweeping camera movement, dramatic clouds, 4K, Planet Earth style"`

### Underwater
- `"Underwater nature documentary: [marine subject], crystal clear water, natural sunlight rays, macro lens detail, Blue Planet style"`

### Timelapse
- `"Timelapse: [natural phenomenon], smooth motion, star trails/cloud movement/plant growth, hyperlapse, 8K quality"`

## API Key Benefits

OpenAI API key를 설정하면:

- **Sora 2 비디오 생성** — 자연 다큐멘터리 스타일의 고품질 영상
- **시네마틱 품질** — 4K 해상도, 영화급 카메라 워크
- **다양한 스타일** — 와일드라이프, 수중, 타임랩스 등

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **Pexels/Pixabay** — 무료 자연 다큐멘터리 스톡 영상 검색 및 다운로드
2. **ffmpeg-video-editor 스킬** — 기존 영상 편집 (트리밍, 필터, 자막 추가)
3. **Hugging Face 무료 모델** — 무료 비디오 생성 모델 (실험적)
4. **Ollama 이미지 → 슬라이드쇼** — 로컬 이미지 생성 후 ffmpeg로 영상 합성

```bash
# 무료 자연 영상 검색 (Pexels API, key 무료)
curl -s "https://api.pexels.com/videos/search?query=nature+documentary&per_page=5" \
  -H "Authorization: YOUR_FREE_PEXELS_KEY"

# 이미지로 슬라이드쇼 영상 만들기 (ffmpeg, 무료)
ffmpeg -framerate 1/3 -i frame%03d.png -c:v libx264 -pix_fmt yuv420p slideshow.mp4
```
