#!/usr/bin/env bun
import { parseArgs } from 'util';
import { processCommand } from './process';
import { getSessionStats } from '../core/session-detector';
import { getStats, getDatesWithoutBragSummary, getSessionsForDate, saveDailySummary } from '../core/db';
import { generateDailyBragSummary } from '../core/summarizer';

interface DailySummaryParsed {
  projects: { name: string; summary: string }[];
}

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h' },
    verbose: { type: 'boolean', short: 'v' },
    force: { type: 'boolean', short: 'f' },
    date: { type: 'string', short: 'd' },
    week: { type: 'string', short: 'w' },
  },
  allowPositionals: true,
});

const command = positionals[0];

async function main() {
  if (values.help === true || !command) {
    printHelp();
    return;
  }

  switch (command) {
    case 'process':
      await processCommand({
        force: values.force ?? false,
        verbose: values.verbose ?? true, // Default to verbose
        date: values.date,
        week: values.week,
      });
      break;

    case 'status':
      statusCommand();
      break;

    case 'serve':
      await serveCommand();
      break;

    case 'regenerate':
      await regenerateCommand(values.force ?? false);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
worklog - Claude Code Session Worklog Generator

Usage:
  bun cli <command> [options]

Commands:
  process     Process new/unprocessed sessions
  status      Show processing stats
  serve       Start web UI server
  regenerate  Regenerate daily summaries (use --force to redo all)

Options:
  -h, --help      Show help
  -v, --verbose   Verbose output
  -f, --force     Reprocess all sessions
  -d, --date      Process only sessions from specific date (YYYY-MM-DD)
  -w, --week      Process only sessions from specific week (YYYY-MM-DD, uses that week)

Examples:
  bun cli process                 # Process new sessions
  bun cli process --force         # Reprocess all
  bun cli process -d 2025-12-18   # Process specific date only
  bun cli process -w 2025-12-16   # Process week containing Dec 16
  bun cli process -d today        # Process today's sessions
  bun cli process -w thisweek     # Process this week's sessions
  bun cli status                  # Show stats
  bun cli serve                   # Start web UI on port 3456
`);
}

function statusCommand() {
  const sessionStats = getSessionStats();
  const dbStats = getStats();

  console.log('\n📊 Worklog Status\n');
  console.log('Session Files:');
  console.log(`  Total files: ${String(sessionStats.totalFiles)}`);
  console.log(`  Projects: ${String(sessionStats.totalProjects)}`);
  console.log(`  Claude paths: ${sessionStats.claudePaths.join(', ')}`);
  console.log('\nProcessed Data:');
  console.log(`  Sessions summarized: ${String(dbStats.totalSessions)}`);
  console.log(`  Days with work: ${String(dbStats.totalDays)}`);
  console.log(`  Projects tracked: ${String(dbStats.totalProjects)}`);
  console.log('');
}

async function serveCommand() {
  // Dynamic import to avoid loading web server code unless needed
  const { startServer } = await import('../web/server');
  startServer();
}

async function regenerateCommand(force: boolean) {
  const { getDb } = await import('../core/db');
  const db = getDb();

  if (force) {
    // Clear all daily summaries to regenerate everything
    db.run('DELETE FROM daily_summaries');
    console.log('\n🗑️  Cleared all daily summaries\n');
  }

  const dates = getDatesWithoutBragSummary();

  if (dates.length === 0) {
    console.log('\n✅ All daily summaries are up to date.\n');
    console.log('Use --force to regenerate all summaries.\n');
    return;
  }

  console.log(`\n📝 Regenerating ${String(dates.length)} daily summaries...\n`);

  for (const date of dates) {
    const sessions = getSessionsForDate(date);
    if (sessions.length === 0) continue;

    try {
      const summary = await generateDailyBragSummary(date, sessions);
      const projectNames = [...new Set(sessions.map(s => s.project_name))].filter((n): n is string => n !== null);
      saveDailySummary(date, summary, projectNames, sessions.length);

      // Parse and show preview
      const parsed = JSON.parse(summary) as DailySummaryParsed;
      const preview = parsed.projects.map((p) => p.name).join(', ');
      console.log(`  ✓ ${date}: ${preview}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${date}: ${errorMessage}`);
    }
  }

  console.log('\n✅ Done!\n');
}

main().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('Error:', errorMessage);
  process.exit(1);
});
