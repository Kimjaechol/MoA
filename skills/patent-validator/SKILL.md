---
name: patent-validator
description: Patent research, prior art search, and patentability validation.
homepage: https://patents.google.com
metadata:
  {
    "openclaw":
      {
        "emoji": "📜",
        "requires": { "bins": ["curl"] },
      },
  }
---

# Patent Validator

Research patents, search for prior art, and validate patentability of inventions. Uses free public patent databases -- no API key required.

## When to use

- Search for existing patents related to an invention idea
- Check for prior art before filing a patent application
- Analyze patent claims and identify potential conflicts
- Generate a prior art report for an invention disclosure

## Quick start

### Search Google Patents

```bash
curl -s "https://patents.google.com/xhr/query?url=q%3Dneural+network+pruning&exp=&tags=" \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
for r in data.get('results', {}).get('cluster', [{}])[0].get('result', [])[:10]:
    pat = r.get('patent', {})
    print(f\"{pat.get('publication_number', 'N/A')}: {pat.get('title', 'No title')}\")
"
```

### Search USPTO (full text)

```bash
curl -s "https://efts.uspto.gov/LATEST/search/applications?searchText=machine+learning+optimization&start=0&rows=10" \
  | jq '.patents[:5] | .[] | {id: .patentNumber, title: .inventionTitle, date: .datePublished}'
```

### Fetch a specific patent

```bash
curl -s "https://patents.google.com/patent/US11123456B2/en" \
  | python3 -c "
import sys, re
html = sys.stdin.read()
title = re.search(r'<title>(.*?)</title>', html)
abstract = re.search(r'<div class=\"abstract\">(.*?)</div>', html, re.DOTALL)
print('Title:', title.group(1) if title else 'N/A')
print('Abstract:', abstract.group(1).strip() if abstract else 'N/A')
"
```

## Prior art report

Generate a structured prior art search:

```bash
node {baseDir}/patent.js prior-art \
  --invention "A method for compressing neural network weights using adaptive quantization" \
  --output prior-art-report.md
```

The report includes:

1. **Search terms** derived from the invention description
2. **Related patents** found in Google Patents and USPTO
3. **Key claims overlap** analysis
4. **Patentability assessment** (novel aspects vs. prior art)

## Patent databases

| Database         | Coverage                  | Access       |
|------------------|---------------------------|------------- |
| Google Patents   | Worldwide, full text      | Free web     |
| USPTO EFTS       | US patents + applications | Free API     |
| Espacenet (EPO)  | European + worldwide      | Free web     |
| WIPO PatentScope | International (PCT)       | Free web     |

## Tips

- Use CPC (Cooperative Patent Classification) codes to narrow searches
- Search both granted patents and published applications
- Check patent family members for international coverage
- This tool aids research only; consult a patent attorney for legal advice
