---
name: transcriptapi
description: Fetch YouTube transcripts and search video content.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "📺",
        "requires": { "bins": ["curl"] },
        "primaryEnv": "TRANSCRIPT_API_KEY",
      },
  }
---

# TranscriptAPI

Fetch transcripts from YouTube videos and search within video content. Useful for summarization, research, and content extraction.

## When to use

- Get the transcript of a YouTube video for summarization or analysis
- Search for specific topics across video transcripts
- Extract key quotes or segments from lectures, podcasts, or interviews
- Build a knowledge base from video content

## Quick start (with API key)

```bash
export TRANSCRIPT_API_KEY="your-key-here"

# Get transcript by video URL
curl -s "https://api.transcriptapi.com/v1/transcript?url=https://youtube.com/watch?v=VIDEO_ID" \
  -H "Authorization: Bearer $TRANSCRIPT_API_KEY" | jq '.transcript'

# Search across transcripts
curl -s "https://api.transcriptapi.com/v1/search?q=machine+learning&channel=CHANNEL_ID" \
  -H "Authorization: Bearer $TRANSCRIPT_API_KEY" | jq '.results'
```

## API Key Setup

1. Sign up at the TranscriptAPI service
2. Generate an API key from your dashboard
3. Export it:

```bash
export TRANSCRIPT_API_KEY="your-key-here"
```

## Free Fallback

Use `yt-dlp` to download auto-generated or manual subtitles directly:

```bash
# Install yt-dlp
pip install yt-dlp
# or: brew install yt-dlp

# Download auto-generated subtitles
yt-dlp --write-auto-sub --sub-lang en --skip-download \
  --sub-format vtt --output "/tmp/%(id)s" \
  "https://youtube.com/watch?v=VIDEO_ID"

# Convert VTT to plain text
python3 -c "
import re, sys
with open('/tmp/VIDEO_ID.en.vtt') as f:
    text = f.read()
# Remove VTT headers and timestamps
text = re.sub(r'WEBVTT.*?\n\n', '', text, flags=re.DOTALL)
text = re.sub(r'\d{2}:\d{2}:\d{2}\.\d{3} --> .*\n', '', text)
text = re.sub(r'<.*?>', '', text)
lines = [l.strip() for l in text.splitlines() if l.strip()]
# Deduplicate consecutive lines (VTT repeats)
deduped = [lines[0]] + [l for i, l in enumerate(lines[1:]) if l != lines[i]]
print(' '.join(deduped))
"
```

### List available subtitles

```bash
yt-dlp --list-subs "https://youtube.com/watch?v=VIDEO_ID"
```

### Download manual subtitles (when available)

```bash
yt-dlp --write-sub --sub-lang en --skip-download \
  --output "/tmp/%(id)s" "https://youtube.com/watch?v=VIDEO_ID"
```

## Tips

- Manual subtitles (`--write-sub`) are higher quality than auto-generated (`--write-auto-sub`)
- For long videos, timestamps in VTT help locate specific segments
- Combine with an LLM to summarize, extract key points, or answer questions about the video
