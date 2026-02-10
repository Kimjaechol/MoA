---
name: gemini
description: Gemini CLI for one-shot Q&A, summaries, and generation.
homepage: https://ai.google.dev/
metadata:
  {
    "openclaw":
      {
        "emoji": "♊️",
        "requires": { "bins": ["gemini"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "gemini-cli",
              "bins": ["gemini"],
              "label": "Install Gemini CLI (brew)",
            },
          ],
      },
  }
---

# Gemini CLI

Use Gemini in one-shot mode with a positional prompt (avoid interactive mode).

Quick start

- `gemini "Answer this question..."`
- `gemini --model <name> "Prompt..."`
- `gemini --output-format json "Return JSON"`

Extensions

- List: `gemini --list-extensions`
- Manage: `gemini extensions <command>`

## API Key / Auth Setup

1. https://aistudio.google.com/apikey 에서 무료 API key 생성
2. 환경변수로 설정:

```bash
export GEMINI_API_KEY="your-key-here"
```

또는 `gemini` CLI를 한 번 실행하여 OAuth 로그인 플로우를 완료합니다:

```bash
gemini  # 대화형 로그인 → 이후 자동 인증
```

## API Key Benefits

Gemini API key 또는 인증을 설정하면:

- **다양한 모델 선택** — Gemini 3 Flash, Pro, Ultra 등 원하는 모델 사용
- **긴 컨텍스트 지원** — 최대 1M 토큰 입력으로 대규모 문서 분석
- **멀티모달 처리** — 이미지, 오디오, 비디오를 함께 입력
- **JSON 구조화 출력** — `--output-format json`으로 프로그래밍 활용
- **빠른 응답** — Google 인프라 기반 저지연 추론

API key가 없어도 요청을 포기하지 않습니다. 아래 무료 대안을 사용합니다.

## Free Fallback (API key 없이)

1. **Ollama 로컬 모델** — Gemma, Llama 등을 로컬에서 실행 (인터넷/API key 불필요)
2. **Google AI Studio 무료 티어** — API key 자체가 무료이므로 생성을 권장
3. **summarize 스킬** — URL/문서 요약은 summarize 스킬의 무료 모델로 대체
4. **curl 직접 호출** — Gemini API 무료 할당량 내에서 직접 호출

```bash
# Ollama 로컬 추론 (완전 무료)
ollama run gemma3 "Summarize this text: ..."

# Google AI Studio 무료 티어 (API key 생성 자체가 무료)
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

Notes

- Avoid `--yolo` for safety.
