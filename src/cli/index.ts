#!/usr/bin/env bun
import { parseArgs } from 'util';
import { processCommand } from './process';
import { getSessionStats } from '../core/session-detector';
import { getStats } from '../core/db';

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: 'boolean', short: 'h' },
    verbose: { type: 'boolean', short: 'v' },
    force: { type: 'boolean', short: 'f' },
    date: { type: 'string', short: 'd' },
  },
  allowPositionals: true,
});

const command = positionals[0];

async function main() {
  if (values.help || !command) {
    printHelp();
    return;
  }

  switch (command) {
    case 'process':
      await processCommand({
        force: values.force ?? false,
        verbose: values.verbose ?? false,
        date: values.date,
      });
      break;

    case 'status':
      await statusCommand();
      break;

    case 'serve':
      await serveCommand();
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

Options:
  -h, --help      Show help
  -v, --verbose   Verbose output
  -f, --force     Reprocess all sessions
  -d, --date      Process only sessions from specific date (YYYY-MM-DD)

Examples:
  bun cli process              # Process new sessions
  bun cli process --force      # Reprocess all
  bun cli process -d 2025-12-18  # Process specific date
  bun cli status               # Show stats
  bun cli serve                # Start web UI on port 3456
`);
}

async function statusCommand() {
  const sessionStats = getSessionStats();
  const dbStats = getStats();

  console.log('\n📊 Worklog Status\n');
  console.log('Session Files:');
  console.log(`  Total files: ${sessionStats.totalFiles}`);
  console.log(`  Projects: ${sessionStats.totalProjects}`);
  console.log(`  Claude paths: ${sessionStats.claudePaths.join(', ')}`);
  console.log('\nProcessed Data:');
  console.log(`  Sessions summarized: ${dbStats.totalSessions}`);
  console.log(`  Days with work: ${dbStats.totalDays}`);
  console.log(`  Projects tracked: ${dbStats.totalProjects}`);
  console.log('');
}

async function serveCommand() {
  // Dynamic import to avoid loading web server code unless needed
  const { startServer } = await import('../web/server');
  await startServer();
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
