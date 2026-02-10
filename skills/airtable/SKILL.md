---
name: airtable
description: Airtable base, table, and record management via REST API with managed OAuth.
homepage: https://airtable.com/developers
metadata:
  {
    "openclaw":
      {
        "emoji": "📊",
        "requires": { "bins": ["node"] },
        "primaryEnv": "AIRTABLE_API_KEY",
      },
  }
---

# Airtable

Manage Airtable bases, tables, and records — create, read, update, delete records and query views via the Airtable REST API.

## When to use

- Query and filter Airtable records
- Create new records in Airtable tables
- Update or delete existing records
- List bases and tables
- Manage Airtable as a lightweight database for projects

## Quick start (with API key)

```bash
export AIRTABLE_API_KEY="pat_your_token_here"

# List records
curl "https://api.airtable.com/v0/{baseId}/{tableName}" \
  -H "Authorization: Bearer $AIRTABLE_API_KEY"

# Create record
curl -X POST "https://api.airtable.com/v0/{baseId}/{tableName}" \
  -H "Authorization: Bearer $AIRTABLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"records": [{"fields": {"Name": "New Item", "Status": "Todo"}}]}'

# Update record
curl -X PATCH "https://api.airtable.com/v0/{baseId}/{tableName}" \
  -H "Authorization: Bearer $AIRTABLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"records": [{"id": "rec...", "fields": {"Status": "Done"}}]}'
```

## API Key Setup

1. Go to https://airtable.com/create/tokens → Create new token
2. Add scopes: data.records:read, data.records:write, schema.bases:read
3. Select the bases you want to access
4. Export the token:

```bash
export AIRTABLE_API_KEY="pat_your_token_here"
```

## API Key Benefits

Airtable API key를 설정하면:

- **레코드 관리** — 생성, 조회, 수정, 삭제 모든 CRUD 작업
- **뷰 기반 쿼리** — 필터, 정렬, 페이지네이션 지원
- **다중 테이블** — 여러 테이블 간 관계형 데이터 관리
- **자동화** — 에이전트가 자동으로 데이터 입력/업데이트

API key가 없어도 요청을 포기하지 않습니다.

## Free Fallback (API key 없이)

1. **로컬 SQLite** — Airtable 대신 로컬 SQLite DB로 데이터 관리
2. **xlsx 스킬** — 스프레드시트 형태의 데이터를 Excel/CSV로 관리
3. **JSON 파일** — 간단한 데이터는 JSON 파일로 CRUD 구현
4. **notion 스킬** — Notion 데이터베이스를 Airtable 대안으로 활용

```bash
# SQLite로 로컬 데이터 관리
sqlite3 ~/data.db "CREATE TABLE tasks (id INTEGER PRIMARY KEY, name TEXT, status TEXT);"
sqlite3 ~/data.db "INSERT INTO tasks (name, status) VALUES ('New Item', 'Todo');"
```
