import { Database } from 'bun:sqlite';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type {
  DBSessionSummary,
  DBDailySummary,
  DBProcessedFile,
  SessionSummary,
  ParsedSession,
  SessionStats,
  DayListItem,
  DayDetail,
  ProjectDetail,
  SessionDetail,
} from '../types';

const DATA_DIR = join(import.meta.dir, '../../data');
const DB_PATH = join(DATA_DIR, 'worklog.db');

let db: Database | null = null;

export function getDb(): Database {
  if (!db) {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    initSchema();
  }
  return db;
}

function initSchema() {
  const database = db!;

  database.exec(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL,
      project_path TEXT NOT NULL,
      project_name TEXT,
      git_branch TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      date TEXT NOT NULL,
      short_summary TEXT,
      accomplishments TEXT,
      tools_used TEXT,
      files_changed TEXT,
      stats TEXT,
      processed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_date ON session_summaries(date);
    CREATE INDEX IF NOT EXISTS idx_session_project ON session_summaries(project_path);

    CREATE TABLE IF NOT EXISTS daily_summaries (
      date TEXT PRIMARY KEY,
      brag_summary TEXT,
      projects_worked TEXT,
      total_sessions INTEGER,
      generated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_files (
      file_path TEXT PRIMARY KEY,
      file_hash TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );
  `);
}

// Processed files tracking
export function isFileProcessed(filePath: string, fileHash: string): boolean {
  const database = getDb();
  const row = database.query<DBProcessedFile, [string]>(
    'SELECT * FROM processed_files WHERE file_path = ?'
  ).get(filePath);

  return row !== null && row.file_hash === fileHash;
}

export function markFileProcessed(filePath: string, fileHash: string): void {
  const database = getDb();
  database.run(
    `INSERT OR REPLACE INTO processed_files (file_path, file_hash, processed_at)
     VALUES (?, ?, ?)`,
    [filePath, fileHash, new Date().toISOString()]
  );
}

// Session summaries
export function saveSessionSummary(
  session: ParsedSession,
  summary: SessionSummary
): void {
  const database = getDb();
  database.run(
    `INSERT OR REPLACE INTO session_summaries
     (session_id, project_path, project_name, git_branch, start_time, end_time, date,
      short_summary, accomplishments, tools_used, files_changed, stats, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.sessionId,
      session.projectPath,
      session.projectName,
      session.gitBranch,
      session.startTime,
      session.endTime,
      session.date,
      summary.shortSummary,
      JSON.stringify(summary.accomplishments),
      JSON.stringify(summary.toolsUsed),
      JSON.stringify(summary.filesChanged),
      JSON.stringify(session.stats),
      new Date().toISOString(),
    ]
  );
}

// Daily summaries
export function saveDailySummary(
  date: string,
  bragSummary: string,
  projectsWorked: string[],
  totalSessions: number
): void {
  const database = getDb();
  database.run(
    `INSERT OR REPLACE INTO daily_summaries
     (date, brag_summary, projects_worked, total_sessions, generated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      date,
      bragSummary,
      JSON.stringify(projectsWorked),
      totalSessions,
      new Date().toISOString(),
    ]
  );
}

// Query functions for API
export function getDays(limit = 30): DayListItem[] {
  const database = getDb();
  const rows = database.query<
    { date: string; project_count: number; session_count: number },
    [number]
  >(`
    SELECT
      date,
      COUNT(DISTINCT project_path) as project_count,
      COUNT(*) as session_count
    FROM session_summaries
    GROUP BY date
    ORDER BY date DESC
    LIMIT ?
  `).all(limit);

  const dailySummaries = new Map<string, string>();
  const summaryRows = database.query<{ date: string; brag_summary: string }, []>(
    'SELECT date, brag_summary FROM daily_summaries'
  ).all();
  for (const row of summaryRows) {
    dailySummaries.set(row.date, row.brag_summary);
  }

  return rows.map((row) => ({
    date: row.date,
    projectCount: row.project_count,
    sessionCount: row.session_count,
    bragSummary: dailySummaries.get(row.date),
  }));
}

export function getDayDetail(date: string): DayDetail | null {
  const database = getDb();
  const sessions = database.query<DBSessionSummary, [string]>(
    'SELECT * FROM session_summaries WHERE date = ? ORDER BY start_time'
  ).all(date);

  if (sessions.length === 0) return null;

  const dailySummary = database.query<DBDailySummary, [string]>(
    'SELECT * FROM daily_summaries WHERE date = ?'
  ).get(date);

  // Group by project
  const projectMap = new Map<string, SessionDetail[]>();
  let totalTokens = 0;

  for (const session of sessions) {
    const stats: SessionStats = JSON.parse(session.stats || '{}');
    totalTokens += (stats.totalInputTokens || 0) + (stats.totalOutputTokens || 0);

    const sessionDetail: SessionDetail = {
      sessionId: session.session_id,
      startTime: session.start_time,
      endTime: session.end_time,
      shortSummary: session.short_summary,
      accomplishments: JSON.parse(session.accomplishments || '[]'),
      filesChanged: JSON.parse(session.files_changed || '[]'),
      toolsUsed: JSON.parse(session.tools_used || '[]'),
      stats,
    };

    const existing = projectMap.get(session.project_path) || [];
    existing.push(sessionDetail);
    projectMap.set(session.project_path, existing);
  }

  const projects: ProjectDetail[] = Array.from(projectMap.entries()).map(
    ([path, sessions]) => ({
      name: sessions[0]?.sessionId ? path.split('/').pop() || path : path,
      path,
      sessions,
    })
  );

  // Get project name from first session
  for (const project of projects) {
    const firstSession = sessions.find((s) => s.project_path === project.path);
    if (firstSession?.project_name) {
      project.name = firstSession.project_name;
    }
  }

  return {
    date,
    bragSummary: dailySummary?.brag_summary,
    projects,
    stats: {
      totalSessions: sessions.length,
      totalTokens,
    },
  };
}

export function getStats(): {
  totalSessions: number;
  totalDays: number;
  totalProjects: number;
} {
  const database = getDb();
  const stats = database.query<
    { total_sessions: number; total_days: number; total_projects: number },
    []
  >(`
    SELECT
      COUNT(*) as total_sessions,
      COUNT(DISTINCT date) as total_days,
      COUNT(DISTINCT project_path) as total_projects
    FROM session_summaries
  `).get();

  return {
    totalSessions: stats?.total_sessions || 0,
    totalDays: stats?.total_days || 0,
    totalProjects: stats?.total_projects || 0,
  };
}

export function getSessionsForDate(date: string): DBSessionSummary[] {
  const database = getDb();
  return database.query<DBSessionSummary, [string]>(
    'SELECT * FROM session_summaries WHERE date = ? ORDER BY start_time'
  ).all(date);
}

export function getDatesWithoutBragSummary(): string[] {
  const database = getDb();
  const rows = database.query<{ date: string }, []>(`
    SELECT DISTINCT s.date
    FROM session_summaries s
    LEFT JOIN daily_summaries d ON s.date = d.date
    WHERE d.date IS NULL
    ORDER BY s.date DESC
  `).all();

  return rows.map((r) => r.date);
}
