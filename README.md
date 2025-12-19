# Worklog

Automatically generates a daily worklog from your Claude Code sessions. See what you actually accomplished, not what you looked at.

## What it does

- Scans Claude Code session files from `~/.claude/projects/`
- Filters to only sessions where code was actually changed (Write/Edit)
- Summarizes each session using Claude Haiku
- Generates daily summaries grouped by project
- Provides a web UI to browse your work history

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
bun cli process              # Process new sessions
bun cli process --force      # Reprocess all sessions
bun cli process -d today     # Process today only
bun cli process -w thisweek  # Process this week only
bun cli process -v           # Verbose output (show parsing details)
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

**Session filtering**: Only sessions with actual code changes are included. Reading, searching, and exploring don't count as work.

**Summarization**: Each session is summarized focusing on outcomes - what was built, fixed, or changed. The daily summary rolls up all sessions by project into brief phrases.

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
