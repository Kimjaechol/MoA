---
name: mcporter
description: Use the mcporter CLI to list, configure, auth, and call MCP servers/tools directly (HTTP or stdio), including ad-hoc servers, config edits, and CLI/type generation.
homepage: http://mcporter.dev
metadata:
  {
    "openclaw":
      {
        "emoji": "📦",
        "requires": { "bins": ["mcporter"] },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "mcporter",
              "bins": ["mcporter"],
              "label": "Install mcporter (node)",
            },
          ],
      },
  }
---

# mcporter

Use `mcporter` to work with MCP servers directly.

Quick start

- `mcporter list`
- `mcporter list <server> --schema`
- `mcporter call <server.tool> key=value`

Call tools

- Selector: `mcporter call linear.list_issues team=ENG limit:5`
- Function syntax: `mcporter call "linear.create_issue(title: \"Bug\")"`
- Full URL: `mcporter call https://api.example.com/mcp.fetch url:https://example.com`
- Stdio: `mcporter call --stdio "bun run ./server.ts" scrape url=https://example.com`
- JSON payload: `mcporter call <server.tool> --args '{"limit":5}'`

Auth + config

- OAuth: `mcporter auth <server | url> [--reset]`
- Config: `mcporter config list|get|add|remove|import|login|logout`

Daemon

- `mcporter daemon start|status|stop|restart`

Codegen

- CLI: `mcporter generate-cli --server <name>` or `--command <url>`
- Inspect: `mcporter inspect-cli <path> [--json]`
- TS: `mcporter emit-ts <server> --mode client|types`

## Auth Benefits

MCP 서버에 OAuth 인증을 설정하면:

- **모든 MCP 도구 접근** — 인증이 필요한 서버의 도구를 직접 호출
- **프라이빗 서버** — 기업 내부 MCP 서버 연결
- **영구 세션** — 인증을 한 번만 하면 재사용

인증 없이도 대부분의 기능을 사용할 수 있습니다.

## Free Fallback (인증 없이)

1. **공개 MCP 서버** — 인증 없이 접근 가능한 공개 서버 사용
2. **로컬 stdio 서버** — `--stdio`로 로컬 MCP 서버 직접 실행 (인증 불필요)
3. **URL 기반 호출** — 공개 HTTP MCP 엔드포인트 직접 호출
4. **설정 파일 수동 관리** — `config/mcporter.json` 직접 편집

```bash
# 로컬 MCP 서버 실행 (인증 불필요)
mcporter call --stdio "bun run ./my-server.ts" my_tool key=value

# 공개 MCP 서버 직접 호출
mcporter call https://public-mcp.example.com/tool param=value
```

Notes

- Config default: `./config/mcporter.json` (override with `--config`).
- Prefer `--output json` for machine-readable results.
