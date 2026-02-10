---
name: agent-browser
description: Headless browser automation using Playwright for web scraping and interaction.
homepage: https://playwright.dev
metadata:
  {
    "openclaw":
      {
        "emoji": "🌐",
        "requires": { "bins": ["node", "npx"] },
      },
  }
---

# Agent Browser

Headless browser automation using Playwright. Navigate web pages, extract content, fill forms, take screenshots, and automate web workflows -- no API key required.

## When to use

- Scrape dynamic web pages that require JavaScript rendering
- Automate form submissions, logins, or multi-step web workflows
- Take screenshots or generate PDFs of web pages
- Extract structured data from websites that lack APIs

## Quick start

1. Install Playwright:

```bash
npm install playwright --prefix {baseDir}
npx --prefix {baseDir} playwright install chromium
```

2. Navigate and extract content:

```bash
node -e "
const { chromium } = require('{baseDir}/node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  const title = await page.title();
  const text = await page.textContent('body');
  console.log('Title:', title);
  console.log('Content:', text.substring(0, 500));
  await browser.close();
})();
"
```

3. Take a screenshot:

```bash
node -e "
const { chromium } = require('{baseDir}/node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  await page.screenshot({ path: '/tmp/screenshot.png', fullPage: true });
  console.log('Screenshot saved to /tmp/screenshot.png');
  await browser.close();
})();
"
```

## Common recipes

### Fill a form

```javascript
await page.fill('#email', 'user@example.com');
await page.fill('#password', 'hunter2');
await page.click('button[type="submit"]');
await page.waitForNavigation();
```

### Wait for dynamic content

```javascript
await page.waitForSelector('.results-loaded');
const items = await page.$$eval('.result-item', els => els.map(e => e.textContent));
```

### Generate PDF

```javascript
await page.pdf({ path: '/tmp/page.pdf', format: 'A4' });
```

### Extract structured data

```javascript
const data = await page.$$eval('table tr', rows =>
  rows.map(row => {
    const cells = row.querySelectorAll('td');
    return Array.from(cells).map(c => c.textContent.trim());
  })
);
console.log(JSON.stringify(data, null, 2));
```

## Tips

- Use `chromium.launch({ headless: true })` (default) for automation; `headless: false` for debugging
- Set `page.setDefaultTimeout(30000)` for slow-loading pages
- Use `page.route()` to block images/ads for faster scraping
- Playwright supports Chromium, Firefox, and WebKit -- install the one you need
