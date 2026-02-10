---
name: smtp-send
description: Send emails via SMTP. Works with any email provider (Gmail, Outlook, custom).
homepage: https://nodemailer.com
metadata:
  {
    "openclaw":
      {
        "emoji": "📧",
        "requires": { "bins": ["node"] },
      },
  }
---

# SMTP Send

Send emails via SMTP using Nodemailer. Works with Gmail, Outlook, Fastmail, or any SMTP server. No paid API key required -- just your email credentials.

## When to use

- Send notification emails from agent workflows
- Deliver reports, summaries, or alerts via email
- Automate email responses or forwarding
- Send emails with attachments (PDFs, CSVs, images)

## Quick start

1. Install Nodemailer:

```bash
npm install nodemailer --prefix {baseDir}
```

2. Send an email:

```bash
node -e "
const nodemailer = require('{baseDir}/node_modules/nodemailer');
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});
transporter.sendMail({
  from: process.env.SMTP_FROM || process.env.SMTP_USER,
  to: 'recipient@example.com',
  subject: 'Test from OpenClaw',
  text: 'Hello from the smtp-send skill!'
}).then(info => console.log('Sent:', info.messageId));
"
```

## SMTP Configuration

Set these environment variables:

```bash
export SMTP_HOST="smtp.gmail.com"
export SMTP_PORT="587"
export SMTP_SECURE="false"
export SMTP_USER="you@gmail.com"
export SMTP_PASS="your-app-password"
export SMTP_FROM="you@gmail.com"
```

### Provider-specific settings

| Provider   | Host                  | Port | Secure | Notes                          |
|------------|-----------------------|------|--------|--------------------------------|
| Gmail      | smtp.gmail.com        | 587  | false  | Use App Password (2FA required)|
| Outlook    | smtp.office365.com    | 587  | false  | Use account password           |
| Fastmail   | smtp.fastmail.com     | 465  | true   | Use App Password               |
| iCloud     | smtp.mail.me.com      | 587  | false  | Use App-Specific Password      |

### Gmail App Password

1. Enable 2-Step Verification at https://myaccount.google.com/security
2. Go to https://myaccount.google.com/apppasswords
3. Generate a password for "Mail" and use it as `SMTP_PASS`

## Send with attachments

```javascript
await transporter.sendMail({
  from: process.env.SMTP_USER,
  to: 'recipient@example.com',
  subject: 'Weekly Report',
  text: 'Please find the report attached.',
  attachments: [
    { filename: 'report.pdf', path: '/tmp/report.pdf' },
    { filename: 'data.csv', path: '/tmp/data.csv' }
  ]
});
```

## Send HTML email

```javascript
await transporter.sendMail({
  from: process.env.SMTP_USER,
  to: 'recipient@example.com',
  subject: 'Status Update',
  html: '<h1>Status</h1><p>All systems operational.</p>'
});
```
