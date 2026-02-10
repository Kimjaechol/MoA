---
name: ffmpeg-video-editor
description: Natural language video editing commands translated to FFmpeg operations.
homepage: https://ffmpeg.org
metadata:
  {
    "openclaw":
      {
        "emoji": "🎬",
        "requires": { "bins": ["ffmpeg"] },
      },
  }
---

# FFmpeg Video Editor

Translate natural language video editing instructions into FFmpeg commands. Edit, convert, trim, merge, and process video and audio files.

## When to use

- Trim or cut video clips by time range
- Merge multiple videos into one
- Convert between video formats (MP4, MOV, AVI, WebM)
- Extract audio from video
- Add subtitles, watermarks, or overlays
- Resize, crop, or rotate videos
- Compress videos for web or mobile
- Create GIFs from video clips

## Quick start

```bash
# Trim video
ffmpeg -i input.mp4 -ss 00:01:00 -to 00:02:30 -c copy trimmed.mp4

# Convert format
ffmpeg -i input.mov -c:v libx264 -c:a aac output.mp4

# Extract audio
ffmpeg -i video.mp4 -vn -c:a libmp3lame audio.mp3

# Merge videos
ffmpeg -f concat -safe 0 -i filelist.txt -c copy merged.mp4

# Create GIF
ffmpeg -i input.mp4 -ss 5 -t 3 -vf "fps=15,scale=480:-1" output.gif

# Add subtitles
ffmpeg -i video.mp4 -vf subtitles=subs.srt output.mp4

# Compress for web
ffmpeg -i input.mp4 -c:v libx264 -crf 28 -preset fast -c:a aac -b:a 128k compressed.mp4
```

## Capabilities (no API key needed)

FFmpeg는 무료 오픈소스 도구입니다. API key 불필요.

- **포맷 변환** — 거의 모든 비디오/오디오 포맷 지원
- **트리밍/자르기** — 정확한 시간 기반 편집
- **필터** — 속도 변경, 회전, 크롭, 워터마크, 자막
- **배치 처리** — 스크립트로 다수 파일 일괄 처리
- **스트리밍** — RTMP, HLS, DASH 스트리밍 지원

## Free Fallback

이 스킬은 API key가 필요하지 않습니다. FFmpeg는 무료 오픈소스입니다.

```bash
# FFmpeg 설치
# macOS
brew install ffmpeg
# Ubuntu/Debian
sudo apt install ffmpeg
```
