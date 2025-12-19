# Worklog Project

A tool that summarizes Claude Code sessions into a daily worklog.

## Architecture

- **CLI** (`src/cli/`): Process sessions, serve web UI
- **Core** (`src/core/`): Session parsing, DB, LLM summarization
- **Web** (`src/web/`): React frontend + Express API
- **DB**: SQLite at `data/worklog.db`

Vite dev server (5173) proxies `/api` to backend (3456).

## Key Design Decisions

### Session Filtering

Only sessions with actual code changes (Write/Edit/NotebookEdit/MultiEdit) are included. Exploration-only sessions (just Read/Grep/Glob) are skipped entirely. This is intentional - reading code is not an accomplishment.

### Prompting for Outcomes

The LLM prompts explicitly say "OUTCOMES only, never exploration" to prevent summaries like "explored codebase" or "reviewed project structure". Focus is on what was BUILT, FIXED, or CHANGED.

## Gotchas

- Haiku sometimes returns malformed structured output (strings instead of arrays). The code has fallback handling for this.
- Kill any stale process on port 3456 before running `bun cli serve`

## Commands

```bash
bun cli process              # Process new sessions
bun cli process --week this  # Process this week only
bun cli serve                # Serve web UI on :3456
bun dev                      # Vite dev server on :5173
```
