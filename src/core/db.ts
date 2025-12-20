import { Database } from 'bun:sqlite';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type {
  DBSessionSummary,
  DBDailySummary,
  DBProcessedFile,
  DBProject,
  SessionSummary,
  ParsedSession,
  SessionStats,
  SessionSource,
  DayListItem,
  DayDetail,
  ProjectDetail,
  SessionDetail,
  ProjectListItem,
  ProjectStatus,
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

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      project_path TEXT UNIQUE NOT NULL,
      project_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      first_session_date TEXT NOT NULL,
      last_session_date TEXT NOT NULL,
      total_sessions INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
  `);

  // Run migrations
  runMigrations();

  // Backfill projects from existing sessions if needed
  backfillProjectsIfNeeded();
}

/**
 * Run database migrations
 */
function runMigrations(): void {
  const database = db!;

  // Check if source column exists
  const columns = database
    .query<{ name: string }, []>(`PRAGMA table_info(session_summaries)`)
    .all();

  const hasSourceColumn = columns.some((col) => col.name === 'source');

  if (!hasSourceColumn) {
    console.log('Migration: Adding source column to session_summaries...');
    database.exec(`
      ALTER TABLE session_summaries ADD COLUMN source TEXT DEFAULT 'claude';
    `);
    console.log('Migration complete.');
  }
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
  summary: SessionSummary,
  source: SessionSource = 'claude'
): void {
  const database = getDb();
  database.run(
    `INSERT OR REPLACE INTO session_summaries
     (session_id, project_path, project_name, git_branch, start_time, end_time, date,
      short_summary, accomplishments, tools_used, files_changed, stats, source, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      source,
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
export function getDays(limit = 365): DayListItem[] {
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

/**
 * Check if a project is new (no sessions before the given date)
 */
export function isNewProject(projectPath: string, beforeDate: string): boolean {
  const database = getDb();
  const row = database.query<{ count: number }, [string, string]>(
    'SELECT COUNT(*) as count FROM session_summaries WHERE project_path = ? AND date < ?'
  ).get(projectPath, beforeDate);

  return (row?.count || 0) === 0;
}

/**
 * Get all new projects for a given date (first appearance)
 */
export function getNewProjectsForDate(date: string): string[] {
  const database = getDb();

  // Get all projects that appear on this date
  const projectsOnDate = database.query<{ project_path: string }, [string]>(
    'SELECT DISTINCT project_path FROM session_summaries WHERE date = ?'
  ).all(date);

  // Filter to those with no prior sessions
  return projectsOnDate
    .filter((p) => isNewProject(p.project_path, date))
    .map((p) => p.project_path);
}

// ============ Project Status Tracking ============

/**
 * Backfill projects table from existing session data (one-time migration)
 */
function backfillProjectsIfNeeded(): void {
  const database = db!;

  // Check if projects table is empty but sessions exist
  const projectCount =
    database
      .query<{ count: number }, []>('SELECT COUNT(*) as count FROM projects')
      .get()?.count || 0;

  const sessionCount =
    database
      .query<{ count: number }, []>(
        'SELECT COUNT(*) as count FROM session_summaries'
      )
      .get()?.count || 0;

  if (projectCount === 0 && sessionCount > 0) {
    console.log('Backfilling projects table from session data...');
    const now = new Date().toISOString();

    database.run(
      `
      INSERT OR IGNORE INTO projects (
        project_path, project_name, status,
        first_session_date, last_session_date, total_sessions,
        created_at, updated_at
      )
      SELECT
        project_path,
        MAX(project_name),
        'in_progress',
        MIN(date),
        MAX(date),
        COUNT(*),
        ?,
        ?
      FROM session_summaries
      GROUP BY project_path
    `,
      [now, now]
    );

    const filled =
      database
        .query<{ count: number }, []>('SELECT COUNT(*) as count FROM projects')
        .get()?.count || 0;
    console.log(`Created ${filled} project records.`);
  }
}

/**
 * Upsert project when processing a session
 */
export function upsertProjectFromSession(
  projectPath: string,
  projectName: string,
  sessionDate: string
): void {
  const database = getDb();
  const now = new Date().toISOString();

  database.run(
    `
    INSERT INTO projects (
      project_path, project_name, status,
      first_session_date, last_session_date, total_sessions,
      created_at, updated_at
    )
    VALUES (?, ?, 'in_progress', ?, ?, 1, ?, ?)
    ON CONFLICT(project_path) DO UPDATE SET
      project_name = COALESCE(NULLIF(excluded.project_name, ''), project_name),
      first_session_date = MIN(first_session_date, excluded.first_session_date),
      last_session_date = MAX(last_session_date, excluded.last_session_date),
      total_sessions = (SELECT COUNT(*) FROM session_summaries WHERE project_path = excluded.project_path),
      updated_at = excluded.updated_at
  `,
    [projectPath, projectName, sessionDate, sessionDate, now, now]
  );
}

/**
 * Get all projects with optional status filter
 */
export function getProjects(status?: ProjectStatus): ProjectListItem[] {
  const database = getDb();
  const today = new Date().toISOString().split('T')[0];

  let query = `
    SELECT
      project_path,
      project_name,
      status,
      first_session_date,
      last_session_date,
      total_sessions,
      CAST(julianday(?) - julianday(last_session_date) AS INTEGER) as days_since_last
    FROM projects
    WHERE project_name != '~'
  `;

  const params: string[] = [today];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY last_session_date DESC';

  const rows = database
    .query<
      {
        project_path: string;
        project_name: string;
        status: ProjectStatus;
        first_session_date: string;
        last_session_date: string;
        total_sessions: number;
        days_since_last: number;
      },
      string[]
    >(query)
    .all(...params);

  return rows.map((row) => ({
    path: row.project_path,
    name: row.project_name,
    status: row.status,
    firstSessionDate: row.first_session_date,
    lastSessionDate: row.last_session_date,
    totalSessions: row.total_sessions,
    daysSinceLastSession: row.days_since_last || 0,
  }));
}

/**
 * Update a project's status
 */
export function updateProjectStatus(
  projectPath: string,
  status: ProjectStatus
): boolean {
  const database = getDb();
  const result = database.run(
    `UPDATE projects SET status = ?, updated_at = ? WHERE project_path = ?`,
    [status, new Date().toISOString(), projectPath]
  );
  return result.changes > 0;
}
