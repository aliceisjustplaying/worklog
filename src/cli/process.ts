import { findUnprocessedSessions, type SessionFile } from '../core/session-detector';
import { parseSessionFile } from '../core/session-reader';
import { summarizeSession, generateDailyBragSummary } from '../core/summarizer';
import {
  markFileProcessed,
  saveSessionSummary,
  saveDailySummary,
  getDatesWithoutBragSummary,
  getSessionsForDate,
} from '../core/db';

interface ProcessOptions {
  force: boolean;
  verbose: boolean;
  date?: string;
}

export async function processCommand(options: ProcessOptions): Promise<{
  sessionsProcessed: number;
  errors: number;
}> {
  const { force, verbose, date } = options;

  console.log('\n🔍 Scanning for sessions...\n');

  let sessions = await findUnprocessedSessions(force);

  // Filter by date if specified
  if (date) {
    // We need to peek into files to filter by date
    // For efficiency, we'll do a rough filter first
    console.log(`Filtering to date: ${date}`);
  }

  if (sessions.length === 0) {
    console.log('✅ No new sessions to process.\n');
    return { sessionsProcessed: 0, errors: 0 };
  }

  console.log(`Found ${sessions.length} session(s) to process\n`);

  // Group by project for display
  const byProject = groupByProject(sessions);
  let processed = 0;
  let errors = 0;
  const datesProcessed = new Set<string>();

  for (const [projectName, projectSessions] of Object.entries(byProject)) {
    console.log(`📁 ${projectName} (${projectSessions.length} sessions)`);

    for (const session of projectSessions) {
      try {
        const result = await processSession(session, verbose);
        if (result.date) {
          datesProcessed.add(result.date);
        }
        processed++;

        const duration = formatDuration(result.startTime, result.endTime);
        const summary = result.summary.slice(0, 60);
        console.log(`  ✓ ${session.sessionId.slice(0, 8)}... (${duration}) → "${summary}..."`);
      } catch (error) {
        errors++;
        console.log(`  ✗ ${session.sessionId.slice(0, 8)}... - Error: ${error}`);
        if (verbose) {
          console.error(error);
        }
      }
    }
    console.log('');
  }

  // Generate brag summaries for new dates
  console.log('📝 Generating daily summaries...\n');
  await generateMissingBragSummaries(verbose);

  console.log(`\n✅ Done! Processed ${processed} sessions (${errors} errors)\n`);
  console.log('Run `bun cli serve` to view your worklog.\n');

  return { sessionsProcessed: processed, errors };
}

async function processSession(
  sessionFile: SessionFile,
  verbose: boolean
): Promise<{
  date: string;
  startTime: string;
  endTime: string;
  summary: string;
}> {
  // Parse the session file
  const parsed = await parseSessionFile(
    sessionFile.path,
    sessionFile.projectPath,
    sessionFile.projectName
  );

  if (verbose) {
    console.log(`    Parsed: ${parsed.messages.length} messages, ${Object.keys(parsed.stats.toolCalls).length} tool types`);
  }

  // Generate summary via LLM
  const summary = await summarizeSession(parsed);

  if (verbose) {
    console.log(`    Summary: ${summary.shortSummary}`);
    console.log(`    Accomplishments: ${summary.accomplishments.length}`);
  }

  // Save to database
  saveSessionSummary(parsed, summary);
  markFileProcessed(sessionFile.path, sessionFile.fileHash);

  return {
    date: parsed.date,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    summary: summary.shortSummary,
  };
}

async function generateMissingBragSummaries(verbose: boolean): Promise<void> {
  const datesWithoutSummary = getDatesWithoutBragSummary();

  for (const date of datesWithoutSummary) {
    try {
      const sessions = getSessionsForDate(date);
      if (sessions.length === 0) continue;

      if (verbose) {
        console.log(`  Generating brag summary for ${date} (${sessions.length} sessions)`);
      }

      const bragSummary = await generateDailyBragSummary(date, sessions);
      const projectNames = [...new Set(sessions.map((s) => s.project_name))];

      saveDailySummary(date, bragSummary, projectNames, sessions.length);

      console.log(`  📣 ${date}: "${bragSummary.slice(0, 80)}..."`);
    } catch (error) {
      console.error(`  Failed to generate brag for ${date}:`, error);
    }
  }
}

function groupByProject(
  sessions: SessionFile[]
): Record<string, SessionFile[]> {
  const grouped: Record<string, SessionFile[]> = {};

  for (const session of sessions) {
    const key = session.projectName;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(session);
  }

  return grouped;
}

function formatDuration(start: string, end: string): string {
  if (!start || !end) return '?';

  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h${remainingMinutes}m`;
}
