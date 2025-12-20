# Worklog

Automatically generates a daily worklog from your Claude Code and OpenAI Codex CLI sessions. See what you actually accomplished, not what you looked at.

<p>
  <img src="screenshot1.png" width="49%" />
  <img src="screenshot2.png" width="49%" />
</p>
<p>
  <img src="screenshot3.png" />
</p>

## What it does

- Scans session files from Claude Code (`~/.claude/projects/`) and Codex CLI (`~/.codex/sessions/`)
- Filters to only sessions where code was actually changed (Write/Edit)
- Summarizes each session using Claude Haiku
- Generates daily summaries grouped by project
- Provides a web UI to browse your work history
- Unifies projects by git root - same repo worked on with both CLIs shows as one project

## Setup

```bash
# Install dependencies
bun install

# Set your API key
export WORKLOG_API_KEY=sk-ant-...

# Process your sessions
bun cli process

# View the web UI
bun dev
```

Then open http://localhost:5173

## Commands

```bash
bun cli process              # Process new sessions (verbose by default)
bun cli process --force      # Reprocess all sessions
bun cli process -d today     # Process today only
bun cli process -w thisweek  # Process this week only
bun cli status               # Show stats
bun cli serve                # Production server on :3456
bun cli regenerate           # Regenerate daily summaries
bun cli regenerate --force   # Regenerate all daily summaries
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `WORKLOG_API_KEY` | - | Anthropic API key (required) |
| `WORKLOG_BASE_URL` | - | Custom API base URL (optional) |
| `SUMMARIZER_MODEL` | `claude-haiku-4-5-20251001` | Model for summarization |

## How it works

**Session location**: Looks for sessions in:
- Claude Code: `~/.claude/projects/` and `~/.config/claude/projects/`
- Codex CLI: `~/.codex/sessions/YYYY/MM/DD/`

To use a custom Claude path, set `CLAUDE_CONFIG_DIR` (comma-separated for multiple). See `src/core/session-detector.ts` and `src/core/codex-detector.ts`.

**Project path detection**: Claude encodes paths with dashes (`-Users-USERNAME-src-a-myproject`), which is lossy. The tool has special handling for:
- `~/src/a/` - active projects
- `~/src/tries/` - experiments (date prefixes like `2025-12-15-foo` → `foo`)
- `~` - home directory sessions shown as "~"

To customize for your own folder structure, edit `decodeProjectFolder()` in `src/core/session-detector.ts`.

**Session filtering**: Only sessions with actual code changes are included. Reading, searching, and exploring don't count as work.

**Summarization**: Each session is summarized focusing on outcomes - what was built, fixed, or changed. The daily summary rolls up all sessions by project into brief phrases.

**Day boundary**: Days end at 3am, not midnight. Work done before 3am counts toward the previous day (aligns with typical sleep schedules). To change this, edit `getEffectiveDate()` in `src/core/session-reader.ts`.

**Storage**: Processed data is stored in `data/worklog.db` (SQLite).

## Development

```bash
bun dev          # Start Vite dev server + API
bun run build    # Build for production
```

## Tech stack

- Bun runtime
- React + Vite + Tailwind
- SQLite (via bun:sqlite)
- Anthropic AI SDK
