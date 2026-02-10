---
name: audiopod
description: Audio processing pipeline -- TTS, STT, noise removal, and track separation.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🎙️",
        "requires": { "bins": ["ffmpeg"] },
        "primaryEnv": "AUDIOPOD_API_KEY",
        "install":
          [
            {
              "id": "brew-ffmpeg",
              "kind": "brew",
              "formula": "ffmpeg",
              "bins": ["ffmpeg"],
              "label": "Install ffmpeg (brew)",
            },
          ],
      },
  }
---

# Audiopod

Audio processing toolkit: text-to-speech, speech-to-text, noise removal, and audio track separation.

## When to use

- Transcribe audio files (meetings, interviews, podcasts)
- Generate speech from text for audio content
- Remove background noise from recordings
- Separate vocals from music (or isolate instruments)

## Quick start (with API key)

```bash
export AUDIOPOD_API_KEY="your-key-here"

node {baseDir}/audiopod.js transcribe --input recording.mp3 --output transcript.txt
node {baseDir}/audiopod.js tts --text "Hello world" --output speech.wav
node {baseDir}/audiopod.js denoise --input noisy.wav --output clean.wav
node {baseDir}/audiopod.js separate --input song.mp3 --output-dir ./stems/
```

## API Key Setup

Get an API key from the Audiopod service dashboard and export it:

```bash
export AUDIOPOD_API_KEY="your-key-here"
```

## Free Fallback

All features work locally without an API key using open-source tools:

### Speech-to-text (Whisper)

```bash
pip install openai-whisper
whisper recording.mp3 --model base --output_format txt --output_dir ./
```

Models: `tiny`, `base`, `small`, `medium`, `large` (larger = more accurate, slower).

### Text-to-speech

Use the `kokoro-tts` or `sherpa-onnx-tts` skill, or:

```bash
# macOS built-in
say -o speech.aiff "Hello world"
ffmpeg -i speech.aiff speech.wav
```

### Noise removal

```bash
# Extract noise profile from a silent segment (first 0.5s), then filter
ffmpeg -i noisy.wav -af "afftdn=nf=-25" clean.wav
```

For better results, use the `arnndn` filter with a pre-trained RNNoise model:

```bash
ffmpeg -i noisy.wav -af "arnndn=m=rnnoise-model.rnnn" clean.wav
```

### Track separation (Demucs)

```bash
pip install demucs
demucs song.mp3 --out ./stems/
# Produces: vocals.wav, drums.wav, bass.wav, other.wav
```

## Audio format conversion

```bash
# Convert any format
ffmpeg -i input.ogg output.wav
ffmpeg -i input.mp3 -ar 16000 -ac 1 output-16k-mono.wav  # whisper-friendly
```

## Tips

- For transcription, 16kHz mono WAV gives best results with Whisper
- Demucs separation quality improves significantly with GPU (CUDA/MPS)
- Chain operations: denoise first, then transcribe for noisy recordings
