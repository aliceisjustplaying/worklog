import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { findGitRoot } from './session-detector';
import type { SessionFile } from '../types';

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
function extractCodexSessionMeta(
  filePath: string
): { cwd: string; sessionId: string; gitBranch: string } | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const firstLine = lines[0];
    if (!firstLine) return null;

    const entry = JSON.parse(firstLine);

    // New format: type === 'session_meta' with payload.cwd
    if (entry.type === 'session_meta' && entry.payload?.cwd) {
      return {
        cwd: entry.payload.cwd,
        sessionId: entry.payload.id || '',
        gitBranch: entry.payload.git?.branch || '',
      };
    }

    // Old format: id at top level, cwd in environment_context message
    if (entry.id && !entry.type) {
      const sessionId = entry.id;
      const gitBranch = entry.git?.branch || '';

      // Search first few lines for environment_context with cwd
      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const line = lines[i];
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'message' && msg.content) {
            for (const block of msg.content) {
              if (block.type === 'input_text' && block.text?.includes('Current working directory:')) {
                const match = block.text.match(/Current working directory: ([^\n\\]+)/);
                if (match) {
                  return { cwd: match[1], sessionId, gitBranch };
                }
              }
            }
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // Invalid JSON or missing fields
  }
  return null;
}

/**
 * Get project name from path, using git root if available
 */
function getProjectInfo(cwd: string): { projectPath: string; projectName: string } {
  // Try to find git root for canonical project identity
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) {
    return {
      projectPath: gitRoot,
      projectName: gitRoot.split('/').pop() || 'unknown',
    };
  }

  // Fallback to cwd itself
  return {
    projectPath: cwd,
    projectName: cwd.split('/').pop() || 'unknown',
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
            if (!meta?.cwd) continue;

            const { projectPath, projectName } = getProjectInfo(meta.cwd);

            sessions.push({
              path: filePath,
              projectPath,
              projectName,
              sessionId: meta.sessionId || file.replace('.jsonl', ''),
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
