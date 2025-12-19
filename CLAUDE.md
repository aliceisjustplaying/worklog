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

- **Haiku double-encoding**: Even with `mode: 'tool'`, Haiku sometimes returns double-encoded JSON where the entire response is a string with escaped quotes. The `tryRecoverMalformedResponse()` function in `summarizer.ts` handles this by regex-extracting fields from the malformed output. If you see "Session details unavailable", check the error logs for recoverable data.
- Kill any stale process on port 3456 before running `bun cli serve`
- **Monorepo path detection**: Claude's path encoding is lossy (`/` → `-`), so `taper-calculator-apps-web` could mean a dashed name or nested dirs. The code probes the filesystem right-to-left to find which interpretation exists, then uses git root as canonical project.

## Summary Quality

Summaries should focus on **capabilities/value**, not code artifacts:
- Good: "added multi-dose scheduling (backend, frontend)"
- Bad: "built dose-splitter module, extended type system, created FrequencySelector"

The `(backend, frontend)` scope suffix shows breadth of work without listing every file. Keep prompts aggressive about consolidation - Haiku tends toward verbosity.

## Commands

```bash
bun cli process              # Process new sessions (also regenerates affected daily summaries)
bun cli process --week this  # Process this week only
bun cli regenerate           # Regenerate missing daily summaries
bun cli regenerate --force   # Regenerate ALL daily summaries
bun cli serve                # Serve web UI on :3456
bun dev                      # Vite dev server on :5173
```
