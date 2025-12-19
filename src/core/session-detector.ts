import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { isFileProcessed } from './db';

export interface SessionFile {
  path: string;
  projectPath: string;
  projectName: string;
  sessionId: string;
  modifiedAt: Date;
  fileHash: string;
}

/**
 * Get possible Claude config directories
 */
export function getClaudePaths(): string[] {
  const envPaths = process.env.CLAUDE_CONFIG_DIR?.split(',') ?? [];
  const defaults = [
    join(homedir(), '.config', 'claude'),
    join(homedir(), '.claude'),
  ];

  return [...envPaths, ...defaults].filter((p) =>
    existsSync(join(p, 'projects'))
  );
}

/**
 * Decode project folder name back to path and extract project name.
 *
 * Claude encodes paths by replacing / with - but project folders under
 * src/a/ or src/tries/ keep their dashes as the project name.
 *
 * Examples:
 *   -Users-USERNAME-src-a-drink-reminder-native
 *     -> path: /Users/USERNAME/src/a/drink-reminder-native
 *     -> name: drink-reminder-native
 *
 *   -Users-USERNAME-src-tries-2025-12-01-myproject
 *     -> path: /Users/USERNAME/src/tries/2025-12-01-myproject
 *     -> name: 2025-12-01-myproject
 */
export function decodeProjectFolder(folderName: string): { path: string; name: string } {
  // Remove leading dash
  const withoutLeading = folderName.slice(1);

  // Find the src/a/ or src/tries/ marker
  const srcAMatch = withoutLeading.match(/^(Users-[^-]+-src-a)-(.+)$/);
  const srcTriesMatch = withoutLeading.match(/^(Users-[^-]+-src-tries)-(.+)$/);

  if (srcAMatch) {
    const basePath = '/' + srcAMatch[1].replace(/-/g, '/');
    const projectName = srcAMatch[2]; // Keep dashes
    return {
      path: `${basePath}/${projectName}`,
      name: projectName,
    };
  }

  if (srcTriesMatch) {
    const basePath = '/' + srcTriesMatch[1].replace(/-/g, '/');
    const projectName = srcTriesMatch[2]; // Keep dashes
    return {
      path: `${basePath}/${projectName}`,
      name: projectName,
    };
  }

  // Fallback: just the folder name with leading dash removed, last segment as name
  const parts = withoutLeading.split('-');
  return {
    path: '/' + withoutLeading.replace(/-/g, '/'),
    name: parts[parts.length - 1] || 'unknown',
  };
}

/**
 * @deprecated Use decodeProjectFolder instead
 */
export function decodeProjectPath(folderName: string): string {
  return decodeProjectFolder(folderName).path;
}

/**
 * @deprecated Use decodeProjectFolder instead
 */
export function getProjectName(projectPath: string): string {
  return projectPath.split('/').filter(Boolean).pop() || 'unknown';
}

/**
 * Calculate MD5 hash of a file
 */
export function getFileHash(filePath: string): string {
  const content = Bun.file(filePath).toString();
  return createHash('md5').update(content).digest('hex');
}

/**
 * Scan for all session files
 */
export function findAllSessionFiles(): SessionFile[] {
  const sessions: SessionFile[] = [];

  for (const claudePath of getClaudePaths()) {
    const projectsDir = join(claudePath, 'projects');
    if (!existsSync(projectsDir)) continue;

    const projectFolders = readdirSync(projectsDir);

    for (const folder of projectFolders) {
      const folderPath = join(projectsDir, folder);
      const stat = statSync(folderPath);
      if (!stat.isDirectory()) continue;

      const { path: projectPath, name: projectName } = decodeProjectFolder(folder);

      // Find all .jsonl files in this project folder
      const files = readdirSync(folderPath).filter((f) => f.endsWith('.jsonl'));

      for (const file of files) {
        const filePath = join(folderPath, file);
        const fileStat = statSync(filePath);
        const sessionId = file.replace('.jsonl', '');

        sessions.push({
          path: filePath,
          projectPath,
          projectName,
          sessionId,
          modifiedAt: fileStat.mtime,
          fileHash: '', // Computed lazily
        });
      }
    }
  }

  // Sort by modification time (newest first)
  sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return sessions;
}

/**
 * Find unprocessed or modified session files
 */
export async function findUnprocessedSessions(
  force = false
): Promise<SessionFile[]> {
  const allSessions = findAllSessionFiles();

  if (force) {
    // Compute hashes for all files
    for (const session of allSessions) {
      session.fileHash = await computeFileHash(session.path);
    }
    return allSessions;
  }

  const unprocessed: SessionFile[] = [];

  for (const session of allSessions) {
    const hash = await computeFileHash(session.path);
    session.fileHash = hash;

    if (!isFileProcessed(session.path, hash)) {
      unprocessed.push(session);
    }
  }

  return unprocessed;
}

/**
 * Compute file hash asynchronously
 */
async function computeFileHash(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const content = await file.text();
  return createHash('md5').update(content).digest('hex');
}

/**
 * Filter sessions by date
 */
export function filterSessionsByDate(
  sessions: SessionFile[],
  targetDate: string
): SessionFile[] {
  // We need to peek into files to check dates, but that's expensive
  // For now, return all and let the processor filter
  return sessions;
}

/**
 * Get stats about session files
 */
export function getSessionStats(): {
  totalFiles: number;
  totalProjects: number;
  claudePaths: string[];
} {
  const allSessions = findAllSessionFiles();
  const projects = new Set(allSessions.map((s) => s.projectPath));

  return {
    totalFiles: allSessions.length,
    totalProjects: projects.size,
    claudePaths: getClaudePaths(),
  };
}
