import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
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
 * Resolve a full encoded path by probing the filesystem.
 * Handles paths like "Users-sarah/.cache-pdf-to-markdown" where we need to find
 * where the base directory ends and the project name (with dashes) begins.
 *
 * If sessionFilePath is provided and filesystem probing fails, reads the session
 * file to extract the original cwd.
 */
function resolveFullPath(encodedPath: string, sessionFilePath?: string): string {
  const parts = encodedPath.split('-');

  // Try interpretations from left to right
  // Build up the path, converting dashes to slashes until we find a directory
  // that contains the rest as a project folder
  for (let i = parts.length - 1; i >= 1; i--) {
    const baseParts = parts.slice(0, i);
    const projectParts = parts.slice(i);

    const basePath = '/' + baseParts.join('/');
    const projectName = projectParts.join('-');

    // Check if basePath exists and contains projectName
    const fullPath = `${basePath}/${projectName}`;
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Filesystem probing failed - try reading cwd from session file
  if (sessionFilePath && existsSync(sessionFilePath)) {
    const cwd = extractCwdFromSessionFile(sessionFilePath);
    if (cwd) {
      return cwd;
    }
  }

  // Nothing found - just convert all dashes to slashes
  return '/' + encodedPath.replace(/-/g, '/');
}

/**
 * Read the first few lines of a session file to extract the cwd.
 */
function extractCwdFromSessionFile(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').slice(0, 10);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.cwd && typeof entry.cwd === 'string') {
          return entry.cwd;
        }
      } catch {}
    }
  } catch {}
  return null;
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
/**
 * Strip date prefix from project names (common in src/tries/ experiments).
 * Pattern: "2025-12-15-todo-calendar-adhd" → "todo-calendar-adhd"
 */
function stripDatePrefix(name: string): string {
  return name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

export function decodeProjectFolder(
  folderName: string,
  sessionFilePath?: string
): { path: string; name: string } {
  // Remove leading dash
  const withoutLeading = folderName.slice(1);

  // Find the src/a/ or src/tries/ marker
  const srcAMatch = withoutLeading.match(/^(Users-[^-]+-src-a)-(.+)$/);
  const srcTriesMatch = withoutLeading.match(/^(Users-[^-]+-src-tries)-(.+)$/);

  let decodedPath: string;
  let isTriesProject = false;

  if (srcAMatch) {
    const basePath = '/' + srcAMatch[1].replace(/-/g, '/');
    const projectPart = srcAMatch[2];
    decodedPath = resolveProjectPath(basePath, projectPart);
  } else if (srcTriesMatch) {
    const basePath = '/' + srcTriesMatch[1].replace(/-/g, '/');
    const projectPart = srcTriesMatch[2];
    decodedPath = resolveProjectPath(basePath, projectPart);
    isTriesProject = true;
  } else {
    // Fallback for paths outside src/a/ and src/tries/
    // Handle hidden folders: -- encodes /. (e.g., /.cache, /.config)
    const withHiddenFolders = withoutLeading.replace(/--/g, '/.');

    // Try to find where the base path ends and project name begins
    // by probing the filesystem progressively, with session file fallback
    decodedPath = resolveFullPath(withHiddenFolders, sessionFilePath);
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
      let projectName = gitRoot.split('/').pop() || 'unknown';
      // Strip date prefix from tries projects
      if (isTriesProject) {
        projectName = stripDatePrefix(projectName);
      }
      return { path: gitRoot, name: projectName };
    }
  }

  // No git root found - use the decoded path as-is
  let projectName = decodedPath.split('/').pop() || 'unknown';
  // Strip date prefix from tries projects
  if (isTriesProject) {
    projectName = stripDatePrefix(projectName);
  }
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

      // Find all .jsonl files in this project folder
      const files = readdirSync(folderPath).filter((f) => f.endsWith('.jsonl'));
      if (files.length === 0) continue;

      // Use the first session file to help decode the project folder
      // (provides cwd fallback when the original directory no longer exists)
      const firstSessionPath = join(folderPath, files[0]);
      const { path: projectPath, name: projectName } = decodeProjectFolder(folder, firstSessionPath);

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
