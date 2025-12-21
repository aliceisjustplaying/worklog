import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { SessionFile } from '../types';
import { findGitRoot } from './session-detector';

/**
 * New format (post-October 2025): session_meta type with nested payload
 */
interface NewFormatEntry {
  type: string;
  payload?: {
    cwd?: string;
    id?: string;
    git?: {
      branch?: string;
    };
  };
}

/**
 * Old format (pre-October 2025): flat structure with id at top level
 */
interface OldFormatEntry {
  id?: string;
  type?: string;
  git?: {
    branch?: string;
  };
}

/**
 * Message entry in old format sessions
 */
interface OldFormatMessage {
  type?: string;
  content?: {
    type?: string;
    text?: string;
  }[];
}

/**
 * Get Codex config directory if it exists
 */
export function getCodexPaths(): string[] {
  const codexPath = join(homedir(), '.codex');
  if (existsSync(join(codexPath, 'sessions'))) {
    return [codexPath];
  }
  return [];
}

/**
 * Extract metadata from a Codex session file
 * Supports both new format (session_meta) and old format (pre-October 2025)
 */
function extractCodexSessionMeta(filePath: string): { cwd: string; sessionId: string; gitBranch: string } | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const firstLine = lines[0] ?? '';
    if (firstLine.length === 0) return null;

    const entry = JSON.parse(firstLine) as unknown;

    // Type guard for new format
    const isNewFormat = (e: unknown): e is NewFormatEntry => {
      return (
        typeof e === 'object' && e !== null && 'type' in e && typeof e.type === 'string' && e.type === 'session_meta'
      );
    };

    // Type guard for old format
    const isOldFormat = (e: unknown): e is OldFormatEntry => {
      return (
        typeof e === 'object' &&
        e !== null &&
        'id' in e &&
        typeof e.id === 'string' &&
        e.id.length > 0 &&
        (!('type' in e) || typeof e.type !== 'string' || e.type.length === 0)
      );
    };

    // New format: type === 'session_meta' with payload.cwd
    if (isNewFormat(entry)) {
      const cwd = entry.payload?.cwd;
      if (cwd !== undefined && cwd.length > 0) {
        return {
          cwd,
          sessionId: entry.payload?.id ?? '',
          gitBranch: entry.payload?.git?.branch ?? '',
        };
      }
    }

    // Old format: id at top level, cwd in environment_context message
    if (isOldFormat(entry)) {
      const sessionId = entry.id ?? '';
      const gitBranch = entry.git?.branch ?? '';

      // Search first few lines for environment_context with cwd
      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const line = lines[i] ?? '';
        if (line.length === 0) continue;
        try {
          const msg = JSON.parse(line) as OldFormatMessage;
          if (msg.type === 'message' && msg.content !== undefined && Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'input_text' && block.text?.includes('Current working directory:') === true) {
                const cwdRegex = /Current working directory: ([^\n\\]+)/;
                const match = cwdRegex.exec(block.text);
                const extractedCwd = match?.[1];
                if (extractedCwd !== undefined) {
                  return { cwd: extractedCwd, sessionId, gitBranch };
                }
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      }
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * Get project name from path, using git root if available
 */
function getProjectInfo(cwd: string): { projectPath: string; projectName: string } {
  // Try to find git root for canonical project identity
  const gitRoot = findGitRoot(cwd);
  if (gitRoot !== null && gitRoot.length > 0) {
    return {
      projectPath: gitRoot,
      projectName: gitRoot.split('/').pop() ?? 'unknown',
    };
  }

  // Fallback to cwd itself
  return {
    projectPath: cwd,
    projectName: cwd.split('/').pop() ?? 'unknown',
  };
}

/**
 * Find all Codex session files
 * Directory structure: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 */
export function findAllCodexSessionFiles(): SessionFile[] {
  const sessions: SessionFile[] = [];

  for (const codexPath of getCodexPaths()) {
    const sessionsDir = join(codexPath, 'sessions');
    if (!existsSync(sessionsDir)) continue;

    // Walk YYYY/MM/DD structure
    const years = readdirSync(sessionsDir).filter((f) => /^\d{4}$/.test(f));

    for (const year of years) {
      const yearPath = join(sessionsDir, year);
      if (!statSync(yearPath).isDirectory()) continue;

      const months = readdirSync(yearPath).filter((f) => /^\d{2}$/.test(f));

      for (const month of months) {
        const monthPath = join(yearPath, month);
        if (!statSync(monthPath).isDirectory()) continue;

        const days = readdirSync(monthPath).filter((f) => /^\d{2}$/.test(f));

        for (const day of days) {
          const dayPath = join(monthPath, day);
          if (!statSync(dayPath).isDirectory()) continue;

          const files = readdirSync(dayPath).filter((f) => f.endsWith('.jsonl'));

          for (const file of files) {
            const filePath = join(dayPath, file);
            const fileStat = statSync(filePath);

            // Extract project info from session_meta
            const meta = extractCodexSessionMeta(filePath);
            if (meta === null || meta.cwd.length === 0) continue;

            const { projectPath, projectName } = getProjectInfo(meta.cwd);

            sessions.push({
              path: filePath,
              projectPath,
              projectName,
              sessionId: meta.sessionId.length > 0 ? meta.sessionId : file.replace('.jsonl', ''),
              modifiedAt: fileStat.mtime,
              fileHash: '', // Computed lazily
              source: 'codex',
            });
          }
        }
      }
    }
  }

  // Sort by modification time (newest first)
  sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return sessions;
}
