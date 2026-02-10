---
name: kokoro-tts
description: Local text-to-speech using the Kokoro model (82M parameters, fully offline).
homepage: https://huggingface.co/hexgrad/Kokoro-82M
metadata:
  {
    "openclaw":
      {
        "emoji": "🔊",
        "requires": { "bins": ["python3"] },
        "install":
          [
            {
              "id": "python-brew",
              "kind": "brew",
              "formula": "python",
              "bins": ["python3"],
              "label": "Install Python (brew)",
            },
          ],
      },
  }
---

# Kokoro TTS

Local text-to-speech using the Kokoro 82M parameter model. Runs entirely offline with no API keys or cloud services.

## When to use

- Convert text to natural-sounding speech locally
- Generate audio for notifications, summaries, or reading content aloud
- Produce voice output in workflows without internet dependency
- Batch-generate audio files from text documents

## Quick start

1. Install dependencies:

```bash
pip install kokoro>=0.8 soundfile torch
```

2. Generate speech:

```python
from kokoro import KPipeline

pipeline = KPipeline(lang_code="a")  # "a" = American English
generator = pipeline("Hello from Kokoro TTS! This runs entirely on your machine.", voice="af_heart")
for i, (gs, ps, audio) in enumerate(generator):
    import soundfile as sf
    sf.write(f"/tmp/kokoro-output-{i}.wav", audio, 24000)
    print(f"Wrote /tmp/kokoro-output-{i}.wav")
```

3. One-liner via CLI:

```bash
python3 -c "
from kokoro import KPipeline
import soundfile as sf
pipe = KPipeline(lang_code='a')
for i, (_, _, audio) in enumerate(pipe('Hello world', voice='af_heart')):
    sf.write(f'/tmp/tts-{i}.wav', audio, 24000)
print('Done')
"
```

## Available voices

Kokoro ships with multiple voice presets:

- `af_heart` -- warm female (default, American)
- `af_bella` -- clear female (American)
- `am_adam` -- neutral male (American)
- `am_michael` -- deep male (American)
- `bf_emma` -- female (British)
- `bm_george` -- male (British)

Full list: `ls $(python3 -c "import kokoro; print(kokoro.__path__[0])")/assets/voices/`

## Language support

Set `lang_code` when constructing the pipeline:

- `a` -- American English
- `b` -- British English
- `j` -- Japanese
- `z` -- Mandarin Chinese

## Performance notes

- Model is 82M parameters; runs well on CPU (M-series Mac: ~10x realtime)
- GPU acceleration via PyTorch CUDA/MPS if available
- First run downloads model weights (~330MB) to HuggingFace cache
