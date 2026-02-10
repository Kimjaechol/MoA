---
name: github
description: "Interact with GitHub using the `gh` CLI. Use `gh issue`, `gh pr`, `gh run`, and `gh api` for issues, PRs, CI runs, and advanced queries."
metadata:
  {
    "openclaw":
      {
        "emoji": "🐙",
        "requires": { "bins": ["gh"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "gh",
              "bins": ["gh"],
              "label": "Install GitHub CLI (brew)",
            },
            {
              "id": "apt",
              "kind": "apt",
              "package": "gh",
              "bins": ["gh"],
              "label": "Install GitHub CLI (apt)",
            },
          ],
      },
  }
---

# GitHub Skill

Use the `gh` CLI to interact with GitHub. Always specify `--repo owner/repo` when not in a git directory, or use URLs directly.

## Pull Requests

Check CI status on a PR:

```bash
gh pr checks 55 --repo owner/repo
```

List recent workflow runs:

```bash
gh run list --repo owner/repo --limit 10
```

View a run and see which steps failed:

```bash
gh run view <run-id> --repo owner/repo
```

View logs for failed steps only:

```bash
gh run view <run-id> --repo owner/repo --log-failed
```

## API for Advanced Queries

The `gh api` command is useful for accessing data not available through other subcommands.

Get PR with specific fields:

```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

## JSON Output

Most commands support `--json` for structured output. You can use `--jq` to filter:

```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```

## Auth Setup

```bash
# GitHub CLI 인증 (한 번만 실행)
gh auth login

# 인증 상태 확인
gh auth status
```

## Auth Benefits

GitHub 인증을 설정하면:

- **PR/이슈 관리** — 생성, 수정, 머지, 코멘트 등 모든 워크플로
- **CI/CD 모니터링** — GitHub Actions 실행 상태 확인, 로그 조회
- **코드 리뷰** — PR diff 확인, 리뷰 코멘트 작성
- **비공개 저장소** — private repo 접근
- **API 호출 한도** — 인증 시 시간당 5,000회 (비인증: 60회)

인증이 안 되어 있어도 요청을 포기하지 않습니다. 아래 무료 대안을 사용합니다.

## Free Fallback (인증 없이)

1. **공개 API** — 인증 없이도 공개 저장소 정보 조회 가능 (시간당 60회)
2. **git CLI** — `git log`, `git diff` 등으로 로컬 저장소 정보 확인
3. **curl + GitHub API** — 인증 없이 공개 저장소 REST API 직접 호출
4. **로컬 분석** — 코드 리뷰와 diff는 로컬 git으로 수행

```bash
# 인증 없이 공개 저장소 정보 조회
curl -s "https://api.github.com/repos/owner/repo/pulls?state=open" | jq '.[].title'

# 로컬 git으로 diff 확인
git log --oneline -10
git diff HEAD~1
```
