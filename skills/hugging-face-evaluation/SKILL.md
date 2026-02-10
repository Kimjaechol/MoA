---
name: hugging-face-evaluation
description: Model evaluation and benchmarking using Hugging Face tools.
homepage: https://huggingface.co/docs/evaluate
metadata:
  {
    "openclaw":
      {
        "emoji": "🤗",
        "requires": { "bins": ["python3"] },
        "primaryEnv": "HF_TOKEN",
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

# Hugging Face Evaluation

Evaluate and benchmark language models using Hugging Face's `evaluate` library and `lm-evaluation-harness`.

## When to use

- Benchmark a model on standard tasks (MMLU, HellaSwag, ARC, TruthfulQA)
- Compare multiple models side-by-side on the same evaluation suite
- Compute metrics (BLEU, ROUGE, perplexity, accuracy) on custom datasets
- Run evaluations locally or via the Hugging Face Hub

## Quick start

1. Install dependencies:

```bash
pip install evaluate datasets transformers torch lm-eval
```

2. Run a quick metric computation:

```python
import evaluate

rouge = evaluate.load("rouge")
results = rouge.compute(
    predictions=["The cat sat on the mat"],
    references=["The cat is sitting on the mat"]
)
print(results)
```

3. Benchmark a model with lm-evaluation-harness:

```bash
lm_eval --model hf --model_args pretrained=microsoft/phi-2 \
  --tasks hellaswag,arc_easy --batch_size 8 --output_path ./eval-results/
```

## API Key Setup

Some features require a Hugging Face token (gated models, private datasets, pushing results to Hub):

```bash
export HF_TOKEN="hf_..."
```

Get your token at https://huggingface.co/settings/tokens

## Free Fallback

Most evaluation tasks work without a token. Only gated models (Llama, Gemma) and Hub uploads require `HF_TOKEN`. For fully local evaluation:

```bash
lm_eval --model hf --model_args pretrained=./local-model-dir \
  --tasks mmlu --batch_size 4
```

## Common benchmarks

| Benchmark    | Tasks | What it measures                   |
|------------- |-------|------------------------------------|
| MMLU         | 57    | Broad knowledge across disciplines |
| HellaSwag    | 1     | Commonsense reasoning              |
| ARC          | 2     | Science question answering         |
| TruthfulQA   | 1     | Truthfulness of responses          |
| GSM8K        | 1     | Math reasoning                     |
| HumanEval    | 1     | Code generation                    |

## Custom evaluation

```python
import evaluate
from datasets import load_dataset

accuracy = evaluate.load("accuracy")
dataset = load_dataset("json", data_files="my_test_set.jsonl")
results = accuracy.compute(predictions=preds, references=labels)
print(f"Accuracy: {results['accuracy']:.3f}")
```
