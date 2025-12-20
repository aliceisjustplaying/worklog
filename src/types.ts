// Session source discriminator
export type SessionSource = 'claude' | 'codex';

// Session file discovered by detector
export interface SessionFile {
  path: string;
  projectPath: string;
  projectName: string;
  sessionId: string;
  modifiedAt: Date;
  fileHash: string;
  source: SessionSource;
}

// Raw JSONL entry from Claude Code session files
export interface RawSessionEntry {
  type: 'user' | 'assistant';
  timestamp: string;
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  cwd?: string;
  gitBranch?: string;
  slug?: string;
  version?: string;
  message: {
    role: 'user' | 'assistant';
    content: MessageContent[];
    model?: string;
    id?: string;
    usage?: TokenUsage;
  };
  requestId?: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'text'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

// Parsed session with extracted info
export interface ParsedSession {
  sessionId: string;
  filePath: string;
  projectPath: string;
  projectName: string;
  gitBranch: string;
  startTime: string;
  endTime: string;
  date: string; // YYYY-MM-DD
  messages: ParsedMessage[];
  stats: SessionStats;
}

export interface ParsedMessage {
  type: 'user' | 'assistant';
  timestamp: string;
  text: string;
  toolUses: ToolUse[];
}

export interface ToolUse {
  name: string;
  input: string; // Truncated/summarized
  rawInput?: Record<string, unknown>; // Full input for file path extraction
}

export interface SessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: Record<string, number>;
  totalInputTokens: number;
  totalOutputTokens: number;
}

// LLM-generated summary
export interface SessionSummary {
  shortSummary: string;
  accomplishments: string[];
  filesChanged: string[];
  toolsUsed: string[];
}

// Database models
export interface DBSessionSummary {
  id: number;
  session_id: string;
  project_path: string;
  project_name: string;
  git_branch: string;
  start_time: string;
  end_time: string;
  date: string;
  short_summary: string;
  accomplishments: string; // JSON array
  tools_used: string; // JSON array
  files_changed: string; // JSON array
  stats: string; // JSON object
  source: SessionSource; // claude or codex
  processed_at: string;
}

export interface DBDailySummary {
  date: string;
  brag_summary: string;
  projects_worked: string; // JSON array
  total_sessions: number;
  generated_at: string;
}

export interface DBProcessedFile {
  file_path: string;
  file_hash: string;
  processed_at: string;
}

export interface ProjectListItem {
  path: string;
  name: string;
  status: ProjectStatus;
  totalSessions: number;
  daysSinceLastSession: number;
}

// API response types
export interface DayListItem {
  date: string;
  projectCount: number;
  sessionCount: number;
  bragSummary?: string;
}

export interface DayDetail {
  date: string;
  bragSummary?: string;
  projects: ProjectDetail[];
  stats: {
    totalSessions: number;
    totalTokens: number;
  };
}

export interface ProjectDetail {
  name: string;
  path: string;
  sessions: SessionDetail[];
}

export interface SessionDetail {
  sessionId: string;
  startTime: string;
  endTime: string;
  shortSummary: string;
  accomplishments: string[];
  filesChanged: string[];
  toolsUsed: string[];
  stats: SessionStats;
}

// Project status tracking
// Extensible - add more statuses here as needed
export type ProjectStatus =
  | 'shipped'
  | 'in_progress'
  | 'ready_to_ship'
  | 'abandoned'
  | 'ignore'
  | 'one_off'
  | 'experiment';

export interface DBProject {
  id: number;
  project_path: string;
  project_name: string;
  status: ProjectStatus;
  first_session_date: string;
  last_session_date: string;
  total_sessions: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectListItem {
  path: string;
  name: string;
  status: ProjectStatus;
  firstSessionDate: string;
  lastSessionDate: string;
  totalSessions: number;
  daysSinceLastSession: number;
}
