---
name: policy-lawyer
description: Policy playbook reference, compliance QA, and regulatory guidance.
homepage: https://github.com/openclaw/openclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "⚖️",
        "requires": { "bins": ["node"] },
      },
  }
---

# Policy Lawyer

Reference and query policy playbooks, compliance frameworks, and regulatory guidelines. Helps answer policy questions, check compliance, and generate policy documents.

## When to use

- Answer questions about internal policies or compliance requirements
- Check whether a proposed action complies with a specific framework (GDPR, SOC2, HIPAA)
- Generate policy documents or checklists from templates
- Review text for policy violations or compliance gaps

## Quick start

### Index a policy document

```bash
node {baseDir}/policy.js index \
  --input ~/policies/privacy-policy.md \
  --framework gdpr \
  --store ~/.openclaw/policy-lawyer/
```

### Ask a policy question

```bash
node {baseDir}/policy.js ask \
  --question "Can we store user email addresses without explicit consent?" \
  --framework gdpr \
  --store ~/.openclaw/policy-lawyer/
```

Sample output:

```
Answer: No. Under GDPR Article 6, processing personal data (including email
addresses) requires a lawful basis. Explicit consent is one such basis, but
legitimate interest may also apply depending on context.

Sources:
  - GDPR Article 6(1)(a): Consent
  - GDPR Article 6(1)(f): Legitimate interest
  - Internal privacy policy, Section 3.2: Data Collection
```

### Compliance check

```bash
node {baseDir}/policy.js check \
  --input feature-spec.md \
  --framework soc2 \
  --output compliance-report.md
```

## Supported frameworks

| Framework | Coverage                                   |
|-----------|--------------------------------------------|
| GDPR      | EU data protection and privacy             |
| SOC 2     | Service organization controls (Trust Services) |
| HIPAA     | US health information privacy              |
| CCPA      | California consumer privacy                |
| ISO 27001 | Information security management            |
| Custom    | Index your own policy documents            |

## Policy generation

Generate a policy document from a template:

```bash
node {baseDir}/policy.js generate \
  --template privacy-policy \
  --company "Acme Corp" \
  --jurisdiction "EU" \
  --output privacy-policy-draft.md
```

Templates: `privacy-policy`, `terms-of-service`, `acceptable-use`, `data-retention`, `incident-response`.

## Tips

- Index all your internal policies for the best Q&A results
- The tool provides guidance, not legal advice; always review with legal counsel
- Keep policy indexes updated when documents change
- Use `--verbose` to see which policy sections were referenced in answers

## Data

Policy indexes are stored at `~/.openclaw/policy-lawyer/` by default.
