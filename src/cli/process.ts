import { findUnprocessedSessions } from '../core/session-detector';
import { parseSessionFile } from '../core/session-reader';
import { parseCodexSessionFile } from '../core/codex-reader';
import type { SessionFile } from '../types';
import { summarizeSession, generateDailyBragSummary } from '../core/summarizer';
import {
  markFileProcessed,
  saveSessionSummary,
  saveDailySummary,
  getDatesWithoutBragSummary,
  getSessionsForDate,
  getNewProjectsForDate,
  upsertProjectFromSession,
} from '../core/db';

interface ProcessOptions {
  force: boolean;
  verbose: boolean;
  date?: string;
  week?: string;
}

// Get start and end of week (Monday-Sunday) for a given date
function getWeekBounds(date: Date): { start: string; end: string } {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMonday = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0],
  };
}

// Parse date string, handling shortcuts like "today", "yesterday"
function parseDate(dateStr: string): string {
  const today = new Date();

  switch (dateStr.toLowerCase()) {
    case 'today':
      return today.toISOString().split('T')[0];
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.toISOString().split('T')[0];
    }
    default:
      // Assume YYYY-MM-DD format
      return dateStr;
  }
}

// Parse week string, handling shortcuts like "thisweek", "lastweek"
function parseWeek(weekStr: string): { start: string; end: string } {
  const today = new Date();

  switch (weekStr.toLowerCase()) {
    case 'thisweek':
    case 'this':
      return getWeekBounds(today);
    case 'lastweek':
    case 'last': {
      const lastWeek = new Date(today);
      lastWeek.setDate(lastWeek.getDate() - 7);
      return getWeekBounds(lastWeek);
    }
    default:
      // Assume YYYY-MM-DD format, get the week containing that date
      return getWeekBounds(new Date(weekStr + 'T12:00:00'));
  }
}

// Check if a date falls within a range
function isDateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export async function processCommand(options: ProcessOptions): Promise<{
  sessionsProcessed: number;
  errors: number;
}> {
  const { force, verbose, date, week } = options;

  // Build date filter
  let dateFilter: { type: 'date'; value: string } | { type: 'range'; start: string; end: string } | null = null;

  if (date) {
    const targetDate = parseDate(date);
    dateFilter = { type: 'date', value: targetDate };
    console.log(`\n📅 Filtering to date: ${targetDate}\n`);
  } else if (week) {
    const { start, end } = parseWeek(week);
    dateFilter = { type: 'range', start, end };
    console.log(`\n📅 Filtering to week: ${start} to ${end}\n`);
  } else {
    console.log('\n🔍 Scanning for sessions...\n');
  }

  let sessions = await findUnprocessedSessions(force);

  // Pre-filter by file modification time if date filter is set
  // This avoids parsing thousands of files just to check their dates
  if (dateFilter && sessions.length > 0) {
    const originalCount = sessions.length;
    const bufferDays = 2; // Allow some buffer for timezone/edge cases

    let startDate: Date, endDate: Date;
    if (dateFilter.type === 'date') {
      startDate = new Date(dateFilter.value + 'T00:00:00');
      endDate = new Date(dateFilter.value + 'T23:59:59');
    } else {
      startDate = new Date(dateFilter.start + 'T00:00:00');
      endDate = new Date(dateFilter.end + 'T23:59:59');
    }

    // Expand range by buffer
    startDate.setDate(startDate.getDate() - bufferDays);
    endDate.setDate(endDate.getDate() + bufferDays);

    sessions = sessions.filter(s =>
      s.modifiedAt >= startDate && s.modifiedAt <= endDate
    );

    console.log(`Pre-filtered ${originalCount} → ${sessions.length} sessions by modification time\n`);
  }

  if (sessions.length === 0) {
    console.log('✅ No new sessions to process.\n');
    return { sessionsProcessed: 0, errors: 0 };
  }

  console.log(`Found ${sessions.length} session(s) to check\n`);

  // Process sessions in parallel with concurrency limit
  const CONCURRENCY = 10;
  const results: Array<{
    session: SessionFile;
    result?: Awaited<ReturnType<typeof processSession>>;
    error?: unknown;
  }> = [];

  // Process in batches
  for (let i = 0; i < sessions.length; i += CONCURRENCY) {
    const batch = sessions.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (session) => {
        try {
          const result = await processSession(session, verbose, dateFilter);
          return { session, result };
        } catch (error) {
          return { session, error };
        }
      })
    );
    results.push(...batchResults);
  }

  // Group results by project for display
  const byProject = groupByProject(sessions);
  let processed = 0;
  let errors = 0;
  const datesProcessed = new Set<string>();

  for (const [projectName, projectSessions] of Object.entries(byProject)) {
    console.log(`📁 ${projectName} (${projectSessions.length} sessions)`);

    let skipped = 0;
    let filtered = 0;

    for (const session of projectSessions) {
      const resultEntry = results.find((r) => r.session === session);
      if (!resultEntry) continue;

      if (resultEntry.error) {
        errors++;
        console.log(`  ✗ ${session.sessionId.slice(0, 8)}... - Error: ${resultEntry.error}`);
        if (verbose) {
          console.error(resultEntry.error);
        }
        continue;
      }

      const result = resultEntry.result!;

      if (result.filtered) {
        filtered++;
        continue;
      }

      if (result.skipped) {
        skipped++;
        if (verbose) {
          console.log(`  ⊘ ${session.sessionId.slice(0, 8)}... (skipped - no work)`);
        }
        continue;
      }

      if (result.date) {
        datesProcessed.add(result.date);
      }
      processed++;

      const duration = formatDuration(result.startTime, result.endTime);
      const summary = result.summary.slice(0, 60);
      console.log(`  ✓ ${session.sessionId.slice(0, 8)}... (${duration}) → "${summary}..."`);
    }

    const notes = [];
    if (skipped > 0) notes.push(`${skipped} empty`);
    if (filtered > 0) notes.push(`${filtered} outside date range`);
    if (notes.length > 0) {
      console.log(`  (${notes.join(', ')} skipped)`);
    }
    console.log('');
  }

  // Generate brag summaries for dates that had new sessions
  console.log('📝 Generating daily summaries...\n');
  await regenerateSummariesForDates(datesProcessed, verbose);

  console.log(`\n✅ Done! Processed ${processed} sessions (${errors} errors)\n`);
  console.log('Run `bun cli serve` to view your worklog.\n');

  return { sessionsProcessed: processed, errors };
}

type DateFilter = { type: 'date'; value: string } | { type: 'range'; start: string; end: string } | null;

async function processSession(
  sessionFile: SessionFile,
  verbose: boolean,
  dateFilter: DateFilter
): Promise<{
  date: string;
  startTime: string;
  endTime: string;
  summary: string;
  skipped: boolean;
  filtered: boolean;
}> {
  // Parse the session file (dispatch based on source)
  const parsed = sessionFile.source === 'codex'
    ? await parseCodexSessionFile(
        sessionFile.path,
        sessionFile.projectPath,
        sessionFile.projectName
      )
    : await parseSessionFile(
        sessionFile.path,
        sessionFile.projectPath,
        sessionFile.projectName
      );

  if (verbose) {
    console.log(`    Parsed: ${parsed.messages.length} messages, ${Object.keys(parsed.stats.toolCalls).length} tool types`);
  }

  // Check date filter BEFORE expensive LLM summarization
  if (dateFilter) {
    const matchesFilter =
      dateFilter.type === 'date'
        ? parsed.date === dateFilter.value
        : isDateInRange(parsed.date, dateFilter.start, dateFilter.end);

    if (!matchesFilter) {
      // Don't mark as processed - we're just skipping for this run
      return {
        date: parsed.date,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        summary: '',
        skipped: false,
        filtered: true,
      };
    }
  }

  // Skip sessions with no actual code changes
  // Exploration (reading, searching) doesn't count as work
  const tools = parsed.stats.toolCalls;

  // Only these tools indicate actual work happened
  const codeChangeTools = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'];
  const hasCodeChanges = codeChangeTools.some(tool => (tools[tool] || 0) > 0);

  if (!hasCodeChanges) {
    // Mark as processed but don't save to DB
    markFileProcessed(sessionFile.path, sessionFile.fileHash);
    return {
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      summary: '',
      skipped: true,
      filtered: false,
    };
  }

  // Generate summary via LLM
  const summary = await summarizeSession(parsed);

  if (verbose) {
    console.log(`    Summary: ${summary.shortSummary}`);
    console.log(`    Accomplishments: ${summary.accomplishments.length}`);
  }

  // Filter out sessions that the LLM determined had no real work
  const noWorkPhrases = [
    'no work', 'no coding', 'was interrupted', 'no substantive',
    'minimal progress', 'minimal activity', 'no significant', 'nothing was accomplished'
  ];
  const summaryLower = summary.shortSummary.toLowerCase();
  if (noWorkPhrases.some(phrase => summaryLower.includes(phrase))) {
    markFileProcessed(sessionFile.path, sessionFile.fileHash);
    return {
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      summary: '',
      skipped: true,
      filtered: false,
    };
  }

  // Save to database
  saveSessionSummary(parsed, summary, sessionFile.source);
  upsertProjectFromSession(parsed.projectPath, parsed.projectName, parsed.date);
  markFileProcessed(sessionFile.path, sessionFile.fileHash);

  return {
    date: parsed.date,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    summary: summary.shortSummary,
    skipped: false,
    filtered: false,
  };
}

async function regenerateSummariesForDates(
  datesToRegenerate: Set<string>,
  verbose: boolean
): Promise<void> {
  // Also include any dates that have never had a summary generated
  const datesWithoutSummary = getDatesWithoutBragSummary();
  const allDates = new Set([...datesToRegenerate, ...datesWithoutSummary]);

  if (allDates.size === 0) return;

  for (const date of allDates) {
    try {
      const sessions = getSessionsForDate(date);
      if (sessions.length === 0) continue;

      // Find which projects are new (first appearance on this date)
      const newProjectPaths = getNewProjectsForDate(date);
      const newProjectNames = new Set(
        sessions
          .filter((s) => newProjectPaths.includes(s.project_path))
          .map((s) => s.project_name)
      );

      if (verbose) {
        console.log(`  Generating brag summary for ${date} (${sessions.length} sessions)`);
        if (newProjectNames.size > 0) {
          console.log(`    New projects: ${[...newProjectNames].join(', ')}`);
        }
      }

      const bragSummary = await generateDailyBragSummary(date, sessions, newProjectNames);
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
