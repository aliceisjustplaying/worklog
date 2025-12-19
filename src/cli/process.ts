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

  // Group by project for display
  const byProject = groupByProject(sessions);
  let processed = 0;
  let errors = 0;
  const datesProcessed = new Set<string>();

  for (const [projectName, projectSessions] of Object.entries(byProject)) {
    console.log(`📁 ${projectName} (${projectSessions.length} sessions)`);

    let skipped = 0;
    let filtered = 0;
    for (const session of projectSessions) {
      try {
        const result = await processSession(session, verbose, dateFilter);

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
      } catch (error) {
        errors++;
        console.log(`  ✗ ${session.sessionId.slice(0, 8)}... - Error: ${error}`);
        if (verbose) {
          console.error(error);
        }
      }
    }
    const notes = [];
    if (skipped > 0) notes.push(`${skipped} empty`);
    if (filtered > 0) notes.push(`${filtered} outside date range`);
    if (notes.length > 0) {
      console.log(`  (${notes.join(', ')} skipped)`);
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
  // Parse the session file
  const parsed = await parseSessionFile(
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

  // Skip sessions with no meaningful work
  // But be careful not to filter out quick fixes!
  const tools = parsed.stats.toolCalls;
  const toolCallCount = Object.values(tools).reduce((a, b) => a + b, 0);

  // Tools that indicate actual code changes happened
  const codeChangeTools = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'];
  const hasCodeChanges = codeChangeTools.some(tool => (tools[tool] || 0) > 0);

  // If code was changed, always keep it (even a 1-line quickfix)
  // Otherwise require substantial exploration/conversation
  const hasSubstantialWork = toolCallCount >= 3;
  const hasLongConversation = parsed.stats.assistantMessages >= 5;

  if (!hasCodeChanges && !hasSubstantialWork && !hasLongConversation) {
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
  saveSessionSummary(parsed, summary);
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
