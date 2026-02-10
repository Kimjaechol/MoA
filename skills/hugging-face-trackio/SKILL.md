---
name: hugging-face-trackio
description: Real-time ML experiment tracking dashboard — loss, metrics, and hyperparameters.
homepage: https://huggingface.co/docs/trackio
metadata:
  {
    "openclaw":
      {
        "emoji": "📈",
        "requires": { "bins": ["uv"] },
        "primaryEnv": "HF_TOKEN",
      },
  }
---

# Hugging Face Trackio

Real-time ML experiment tracking dashboard. Monitor training loss, metrics, hyperparameters, and model performance during SLM fine-tuning and evaluation.

## When to use

- Track SLM fine-tuning progress in real-time
- Monitor training loss and validation metrics
- Compare hyperparameters across experiments
- Visualize learning curves
- Log and compare model evaluation results

## Quick start (with API key)

```bash
export HF_TOKEN="hf_your_token_here"

# Initialize tracking for a training run
uv run {baseDir}/trackio.py init \
  --project "moa-slm-finetune" \
  --run-name "qwen3-4b-legal-sft-v1" \
  --config '{"model": "Qwen3-4B", "method": "SFT", "lr": 2e-5}'

# Log metrics during training
uv run {baseDir}/trackio.py log \
  --step 100 \
  --metrics '{"loss": 0.342, "eval_accuracy": 0.87, "lr": 1.8e-5}'

# View dashboard
uv run {baseDir}/trackio.py dashboard --project "moa-slm-finetune"
```

## API Key Setup

1. Sign up at https://huggingface.co
2. Create a token at https://huggingface.co/settings/tokens
3. Export it:

```bash
export HF_TOKEN="hf_your_token_here"
```

## API Key Benefits

HF_TOKEN을 설정하면:

- **실시간 대시보드** — 학습 진행 상황을 웹 대시보드에서 실시간 확인
- **실험 비교** — 여러 학습 실행의 메트릭을 병렬 비교
- **하이퍼파라미터 추적** — 최적 설정을 체계적으로 관리
- **팀 협업** — HF Spaces에서 팀원과 결과 공유
- **모델 연결** — 학습된 모델과 실험 결과 자동 링크

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **로컬 CSV 로그** — 학습 메트릭을 CSV 파일에 기록
2. **TensorBoard** — 로컬 TensorBoard로 학습 시각화
3. **JSON 로그** — JSONL 파일로 실험 결과 저장
4. **matplotlib** — Python으로 로컬 학습 곡선 차트 생성

```bash
# 로컬 TensorBoard (API key 불필요)
pip install tensorboard
tensorboard --logdir ./runs

# CSV로 학습 메트릭 로그
echo "step,loss,accuracy" > training_log.csv
echo "100,0.342,0.87" >> training_log.csv
```

## MoA SLM 파인튜닝과의 연동

`hugging-face-model-trainer`로 SLM을 파인튜닝할 때, `hugging-face-trackio`로 학습 과정을 모니터링하고, `hugging-face-evaluation`으로 최종 성능을 평가하는 파이프라인을 구성합니다:

```
hugging-face-model-trainer (학습)
    ↓ 학습 중 메트릭 로그
hugging-face-trackio (모니터링)
    ↓ 학습 완료
hugging-face-evaluation (평가)
    ↓ 성능 검증 완료
GGUF 변환 → Ollama 배포
```
