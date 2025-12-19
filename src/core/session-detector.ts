import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { isFileProcessed } from './db';

/**
 * Find the git root for a given path.
 * Returns the path if it's a git root, or walks up to find one.
 * Returns null if no git root is found.
 */
function findGitRoot(path: string): string | null {
  let current = path;
  const root = '/';

  while (current !== root) {
    if (existsSync(join(current, '.git'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break; // Reached filesystem root
    current = parent;
  }

  return null;
}

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
 * Try different interpretations of a dash-separated string by progressively
 * replacing dashes with slashes from right to left.
 *
 * For "taper-calculator-apps-web", tries:
 *   1. taper-calculator-apps-web (all dashes literal)
 *   2. taper-calculator-apps/web
 *   3. taper-calculator/apps/web
 *   4. taper/calculator/apps/web (all dashes as slashes)
 *
 * Returns the first path that exists on the filesystem.
 */
function resolveProjectPath(basePath: string, projectPart: string): string {
  // Split on dashes
  const parts = projectPart.split('-');

  // Try interpretations from "all dashes literal" to "all dashes as slashes"
  // We iterate by how many trailing parts are split off as directories
  for (let splitCount = 0; splitCount <= parts.length - 1; splitCount++) {
    let path: string;

    if (splitCount === 0) {
      // Keep all dashes - treat entire projectPart as folder name
      path = `${basePath}/${projectPart}`;
    } else {
      // Split the last N parts as subdirectories
      const projectNameParts = parts.slice(0, parts.length - splitCount);
      const subdirParts = parts.slice(parts.length - splitCount);
      const projectName = projectNameParts.join('-');
      const subdirs = subdirParts.join('/');
      path = `${basePath}/${projectName}/${subdirs}`;
    }

    if (existsSync(path)) {
      return path;
    }
  }

  // Nothing exists - return the literal interpretation (all dashes preserved)
  return `${basePath}/${projectPart}`;
}

/**
 * Decode project folder name back to path and extract project name.
 *
 * Claude encodes paths by replacing / with - but project folders under
 * src/a/ or src/tries/ may have dashes in their actual names.
 *
 * Since the encoding is lossy, we probe the filesystem to find the correct
 * interpretation, then use git root as the canonical project identity.
 *
 * Examples:
 *   -Users-USERNAME-src-a-drink-reminder-native
 *     -> tries: drink-reminder-native (exists!) ✓
 *     -> path: /Users/USERNAME/src/a/drink-reminder-native
 *     -> name: drink-reminder-native
 *
 *   -Users-USERNAME-src-a-taper-calculator-apps-web
 *     -> tries: taper-calculator-apps-web (doesn't exist)
 *     -> tries: taper-calculator-apps/web (doesn't exist)
 *     -> tries: taper-calculator/apps/web (exists!) ✓
 *     -> git root: /Users/USERNAME/src/a/taper-calculator
 *     -> name: taper-calculator
 */
export function decodeProjectFolder(folderName: string): { path: string; name: string } {
  // Remove leading dash
  const withoutLeading = folderName.slice(1);

  // Find the src/a/ or src/tries/ marker
  const srcAMatch = withoutLeading.match(/^(Users-[^-]+-src-a)-(.+)$/);
  const srcTriesMatch = withoutLeading.match(/^(Users-[^-]+-src-tries)-(.+)$/);

  let decodedPath: string;

  if (srcAMatch) {
    const basePath = '/' + srcAMatch[1].replace(/-/g, '/');
    const projectPart = srcAMatch[2];
    decodedPath = resolveProjectPath(basePath, projectPart);
  } else if (srcTriesMatch) {
    const basePath = '/' + srcTriesMatch[1].replace(/-/g, '/');
    const projectPart = srcTriesMatch[2];
    decodedPath = resolveProjectPath(basePath, projectPart);
  } else {
    // Fallback: just replace all dashes with slashes
    decodedPath = '/' + withoutLeading.replace(/-/g, '/');
  }

  // Special case: home directory should show as "~"
  const homeDir = homedir();
  if (decodedPath === homeDir) {
    return { path: decodedPath, name: '~' };
  }

  // Try to find git root to normalize monorepo subdirectories
  if (existsSync(decodedPath)) {
    const gitRoot = findGitRoot(decodedPath);
    if (gitRoot) {
      const projectName = gitRoot.split('/').pop() || 'unknown';
      return { path: gitRoot, name: projectName };
    }
  }

  // No git root found - use the decoded path as-is
  const projectName = decodedPath.split('/').pop() || 'unknown';
  return { path: decodedPath, name: projectName };
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
