---
name: evaluation
description: Agent system evaluation framework for measuring quality, latency, and reliability.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "📏",
        "requires": { "bins": ["node"] },
      },
  }
---

# Evaluation

Framework for evaluating agent systems end-to-end: response quality, tool use accuracy, latency, cost, and reliability.

## When to use

- Measure agent performance before and after changes (regression testing)
- Compare different model backends or prompt strategies
- Evaluate tool-calling accuracy and multi-step task completion
- Track quality metrics over time with automated benchmarks

## Quick start

1. Define an evaluation suite:

```yaml
# eval-suite.yaml
name: "agent-baseline"
cases:
  - id: weather-query
    input: "What is the weather in Tokyo?"
    expected_tools: ["weather"]
    criteria:
      - contains: "Tokyo"
      - contains_any: ["temperature", "degrees", "forecast"]

  - id: math-task
    input: "What is 247 * 19?"
    criteria:
      - exact: "4693"

  - id: multi-step
    input: "Find the latest PR on openclaw/openclaw and summarize it"
    expected_tools: ["github"]
    criteria:
      - min_length: 50
```

2. Run the evaluation:

```bash
node {baseDir}/eval.js run --suite eval-suite.yaml --output ./eval-results/
```

3. View results:

```bash
node {baseDir}/eval.js report --results ./eval-results/
```

## Metrics

| Metric              | Description                                      |
|---------------------|--------------------------------------------------|
| Pass rate           | Percentage of cases meeting all criteria          |
| Tool accuracy       | Correct tool selection rate                       |
| Latency (p50/p95)   | Response time percentiles                        |
| Token usage         | Input/output tokens per case                     |
| Cost estimate       | Estimated API cost per evaluation run            |

## Criteria types

- `exact` -- output must match exactly
- `contains` -- output must include substring
- `contains_any` -- output must include at least one of the strings
- `regex` -- output must match a regular expression
- `min_length` / `max_length` -- character count bounds
- `llm_judge` -- use a separate LLM to score quality (0-10)

## Comparison runs

```bash
node {baseDir}/eval.js compare \
  --baseline ./eval-results/run-001/ \
  --candidate ./eval-results/run-002/
```

Outputs a diff table showing regressions and improvements per test case.

## CI integration

Add to your CI pipeline to catch regressions:

```bash
node {baseDir}/eval.js run --suite eval-suite.yaml --fail-below 0.9
```

Exits with code 1 if pass rate drops below the threshold.
