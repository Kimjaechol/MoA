---
name: para-second-brain
description: PARA method knowledge organization (Projects, Areas, Resources, Archive).
homepage: https://fortelabs.com/blog/para/
metadata:
  {
    "openclaw":
      {
        "emoji": "📂",
        "requires": { "bins": ["node"] },
      },
  }
---

# PARA Second Brain

Organize knowledge using Tiago Forte's PARA method: Projects, Areas, Resources, and Archive. Works with local files, Obsidian vaults, or any folder-based system.

## When to use

- Organize notes, documents, and references into a structured knowledge base
- Decide where to file new information using the PARA hierarchy
- Review and maintain your knowledge system (weekly/monthly reviews)
- Migrate or reorganize an existing notes collection into PARA

## PARA structure

```
Second Brain/
  Projects/       # Active projects with deadlines (e.g., "Launch website")
  Areas/          # Ongoing responsibilities (e.g., "Health", "Finance")
  Resources/      # Topics of interest (e.g., "Machine Learning", "Cooking")
  Archive/        # Completed projects and inactive items
```

## Quick start

1. Initialize a PARA structure:

```bash
node {baseDir}/para.js init --root ~/SecondBrain
```

This creates the four top-level folders and a `_index.json` metadata file.

2. File a new note:

```bash
node {baseDir}/para.js file \
  --input ~/Downloads/meeting-notes.md \
  --category project \
  --project "Website Redesign"
```

3. Classify automatically:

```bash
node {baseDir}/para.js classify --input ~/Downloads/random-note.md
# Output: Suggested location: Resources/Machine Learning
# Reason: Note discusses transformer architectures (reference material, no deadline)
```

## Commands

| Command    | Description                                      |
|------------|--------------------------------------------------|
| `init`     | Create PARA folder structure                     |
| `file`     | Move a file into the correct PARA location       |
| `classify` | Suggest where a note belongs                     |
| `review`   | List stale projects and items to archive         |
| `archive`  | Move completed projects to Archive               |
| `search`   | Search across all PARA categories                |
| `stats`    | Show counts and sizes per category               |

## Weekly review

```bash
node {baseDir}/para.js review --root ~/SecondBrain
```

Reports:

- Projects with no activity in 14+ days (consider archiving or updating)
- Areas with recent additions (check if any should become projects)
- Resources that could be promoted to Areas if you are investing time

## Integration with Obsidian

If your PARA root is an Obsidian vault, the tool respects `.obsidian/` config and uses wikilinks:

```bash
node {baseDir}/para.js init --root ~/ObsidianVault --format obsidian
```

## Tips

- Keep Projects small and time-bound (1-4 weeks)
- Areas are ongoing (no end date): "Health", "Career", "Home"
- Resources are reference material you might need later
- Archive aggressively; you can always search and retrieve
