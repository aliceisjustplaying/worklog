# Worklog Project

A tool that summarizes Claude Code and OpenAI Codex CLI sessions into a daily worklog.

## Architecture

- **CLI** (`src/cli/`): Process sessions, serve web UI
- **Core** (`src/core/`): Session parsing, DB, LLM summarization
- **Web** (`src/web/`): React frontend + Express API
- **DB**: SQLite at `data/worklog.db`

Run `bun dev` for development (hot reload on :5173, API on :3456).

### Multi-Source Session Support

Both Claude Code and Codex CLI sessions are supported:
- **Claude**: `~/.claude/projects/{encoded-path}/*.jsonl`
- **Codex**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`

Projects are unified by git root - same repo worked on with both CLIs shows as one project. The `source` column in `session_summaries` tracks origin.

## Key Design Decisions

### Session Filtering

Only sessions with actual code changes (Write/Edit/NotebookEdit/MultiEdit) are included. Exploration-only sessions (just Read/Grep/Glob) are skipped entirely. This is intentional - reading code is not an accomplishment.

### Prompting for Outcomes

The LLM prompts explicitly say "OUTCOMES only, never exploration" to prevent summaries like "explored codebase" or "reviewed project structure". Focus is on what was BUILT, FIXED, or CHANGED.

## Gotchas

- **Haiku double-encoding**: Even with `mode: 'tool'`, Haiku sometimes returns double-encoded JSON where the entire response is a string with escaped quotes. The `tryRecoverMalformedResponse()` function in `summarizer.ts` handles this by regex-extracting fields from the malformed output. If you see "Session details unavailable", check the error logs for recoverable data.
- Kill any stale process on port 3456 before running `bun cli serve`
- **Monorepo path detection**: Claude's path encoding is lossy (`/` → `-`), so `taper-calculator-apps-web` could mean a dashed name or nested dirs. The code probes the filesystem right-to-left to find which interpretation exists, then uses git root as canonical project.
- **Codex tool types**: Codex uses both `function_call` AND `custom_tool_call` in response_items. The `apply_patch` tool uses `custom_tool_call`, while `shell_command` uses `function_call`. Both must be handled in `codex-reader.ts`.
- **Old Codex format (pre-October 2025)**: Sessions before October 2025 have a completely different structure - no `type: 'session_meta'` wrapper, no timestamps on individual entries, and `apply_patch` embedded in shell command heredocs. The working directory must be extracted from the `environment_context` message content, not metadata. See `codex-detector.ts` and `codex-reader.ts` for the dual-format handling.
- **API/db default layering**: When changing default values (like query limits), check BOTH the db function AND the API handler. The API handler in `api.ts` can override db.ts defaults with its own fallback values.

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
bun dev                      # Dev server with hot reload (:5173)
bun cli serve                # Production server (:3456)
```
