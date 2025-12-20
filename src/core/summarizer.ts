import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ParsedSession, SessionSummary, DBSessionSummary } from '../types';
import { createCondensedTranscript } from './session-reader';

const anthropic = createAnthropic({
  apiKey: process.env.WORKLOG_API_KEY,
  ...(process.env.WORKLOG_BASE_URL !== undefined && process.env.WORKLOG_BASE_URL.length > 0 && { baseURL: process.env.WORKLOG_BASE_URL }),
  headers: {
    'Accept-Encoding': 'identity',
  },
});

const MODEL = process.env.SUMMARIZER_MODEL ?? 'claude-haiku-4-5-20251001';

/**
 * Try to recover valid JSON from malformed Haiku responses.
 * Haiku sometimes returns double-encoded JSON where the entire response
 * is wrapped in a string literal with escaped quotes.
 *
 * Common pattern: {"shortSummary":"actual summary\",\"accomplishments\": [...rest of JSON...]"}
 * The model puts the whole JSON inside shortSummary with escaped quotes.
 */
function tryRecoverMalformedResponse(error: unknown): {
  shortSummary?: string;
  accomplishments?: string[];
  filesChanged?: string[];
  toolsUsed?: string[];
} | null {
  try {
    // The error object may have a 'text' property with the malformed response
    const errorObj = error as { text?: string; cause?: { value?: unknown } };

    // Try the text field first (AI_NoObjectGeneratedError)
    let rawText = errorObj.text;

    // Also try cause.value which contains the parsed (but invalid) object
    if (rawText === undefined && errorObj.cause?.value !== undefined) {
      const value = errorObj.cause.value as { shortSummary?: string };
      // If shortSummary contains escaped JSON structure, extract it
      if (value.shortSummary?.includes('"accomplishments"') === true) {
        rawText = value.shortSummary;
      }
    }

    if (rawText === undefined || typeof rawText !== 'string') return null;

    // Unescape the content
    const unescaped = rawText
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');

    // Pattern: the model returned JSON with shortSummary containing the rest
    // Extract: shortSummary ends at ",\n"accomplishments" or similar
    const summaryMatch = /"shortSummary"\s*:\s*"([^"]+)"/.exec(unescaped);
    const accomplishmentsMatch = /"accomplishments"\s*:\s*\[([\s\S]*?)\]/.exec(unescaped);
    const filesMatch = /"filesChanged"\s*:\s*\[([\s\S]*?)\]/.exec(unescaped);
    const toolsMatch = /"toolsUsed"\s*:\s*\[([\s\S]*?)\]/.exec(unescaped);

    if (summaryMatch !== null) {
      const parseArray = (match: RegExpMatchArray | null): string[] => {
        if (match === null) return [];
        try {
          const parsed: unknown = JSON.parse(`[${match[1]}]`);
          if (Array.isArray(parsed)) {
            return parsed.filter((item): item is string => typeof item === 'string');
          }
          return [];
        } catch {
          // Extract strings manually
          const items: string[] = [];
          const re = /"([^"]+)"/g;
          let m;
          while ((m = re.exec(match[1])) !== null) {
            items.push(m[1]);
          }
          return items;
        }
      };

      return {
        shortSummary: summaryMatch[1],
        accomplishments: parseArray(accomplishmentsMatch),
        filesChanged: parseArray(filesMatch),
        toolsUsed: parseArray(toolsMatch),
      };
    }

    // Last resort: try to parse as complete JSON object
    try {
      const jsonMatch = /\{[\s\S]*"shortSummary"[\s\S]*\}/.exec(unescaped);
      if (jsonMatch !== null) {
        const parsed: unknown = JSON.parse(jsonMatch[0]);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'shortSummary' in parsed &&
          'accomplishments' in parsed &&
          typeof parsed.shortSummary === 'string' &&
          Array.isArray(parsed.accomplishments)
        ) {
          return parsed as {
            shortSummary: string;
            accomplishments: string[];
            filesChanged?: string[];
            toolsUsed?: string[];
          };
        }
      }
    } catch {
      // Failed to parse as complete JSON, continue to outer catch
    }
  } catch {
    // Recovery failed, will fall back to placeholder
  }
  return null;
}

// Zod schema for session summaries - using .describe() for better LLM understanding
const sessionSummarySchema = z.object({
  shortSummary: z
    .string()
    .describe('1-2 sentence summary focusing on capabilities/value, not code artifacts. What can users do now? What problem was solved?'),
  accomplishments: z
    .array(z.string())
    .describe('List of outcomes framed as capabilities or value. Never list modules/types/components as accomplishments.'),
  filesChanged: z
    .array(z.string())
    .describe('List of files that were modified or created'),
  toolsUsed: z
    .array(z.string())
    .describe('List of tools used like Edit, Bash, Read, Write, Grep'),
});

/**
 * Generate a summary for a session using Claude with structured output
 */
export async function summarizeSession(
  session: ParsedSession
): Promise<SessionSummary> {
  const transcript = createCondensedTranscript(session);

  const systemPrompt = `Summarize this Claude Code session for a worklog. Be concise.

The transcript shows SCOPE (frontend/backend). Include it in parentheses.

FORMAT: "[Action] [capability] ([scope])"
Examples:
- "Added multi-dose scheduling (backend, frontend)"
- "Fixed dark mode styling (frontend)"
- "Implemented HealthKit sync (backend, frontend)"

Rules:
- ONE main accomplishment, maybe two if truly separate work
- Use action verbs: added, fixed, implemented, built
- Never list code artifacts (modules, types, components)
- Describe what users can DO, not what code exists

Bad: "Created FrequencySelector component, extended type system, updated CSV export"
Good: "Added dose frequency selection (frontend, backend)"`;

  const userPrompt = `Summarize this Claude Code session:\n\n${transcript}`;

  try {
    const { object } = await generateObject({
      model: anthropic(MODEL),
      schema: sessionSummarySchema,
      system: systemPrompt,
      prompt: userPrompt,
    });

    return {
      shortSummary: object.shortSummary,
      accomplishments: object.accomplishments,
      filesChanged: object.filesChanged,
      toolsUsed: object.toolsUsed.length > 0
        ? object.toolsUsed
        : Object.keys(session.stats.toolCalls),
    };
  } catch (error: unknown) {
    // Haiku sometimes returns double-encoded JSON (valid JSON wrapped in a string)
    // Try to recover by parsing the text field from the error
    const recovered = tryRecoverMalformedResponse(error);
    if (recovered !== null) {
      return {
        shortSummary: recovered.shortSummary ?? 'Session completed',
        accomplishments: recovered.accomplishments ?? [],
        filesChanged: recovered.filesChanged ?? [],
        toolsUsed: (recovered.toolsUsed?.length ?? 0) > 0
          ? recovered.toolsUsed ?? []
          : Object.keys(session.stats.toolCalls),
      };
    }

    // Return a basic summary on failure
    console.error('Summarization error (unrecoverable):', (error as Error).message);
    return {
      shortSummary: `Worked on ${session.projectName}`,
      accomplishments: ['Session details unavailable'],
      filesChanged: [],
      toolsUsed: Object.keys(session.stats.toolCalls),
    };
  }
}

// Schema for daily summary - structured for easy rendering
const dailySummarySchema = z.object({
  projects: z
    .array(z.object({
      name: z.string().describe('Project name - use exactly as given'),
      summary: z.string().describe('Brief capabilities with scope, like "multi-dose scheduling (backend, frontend), dark mode (frontend)"'),
    }))
    .describe('List of projects with brief outcome summaries including scope'),
});

// Extended schema with isNew flag (added post-LLM)
interface DailySummaryWithNew {
  projects: {
    name: string;
    summary: string;
    isNew?: boolean;
  }[];
}

export type DailySummary = z.infer<typeof dailySummarySchema>;

/**
 * Generate a daily summary from multiple session summaries
 * Returns structured data for easy rendering
 */
export async function generateDailyBragSummary(
  date: string,
  sessions: DBSessionSummary[],
  newProjectNames = new Set<string>()
): Promise<string> {
  if (sessions.length === 0) {
    return JSON.stringify({ projects: [] });
  }

  // Group accomplishments by project
  const accomplishmentsByProject = new Map<string, string[]>();
  for (const session of sessions) {
    const project = session.project_name ?? 'Unknown';
    if (!accomplishmentsByProject.has(project)) {
      accomplishmentsByProject.set(project, []);
    }
    if (session.accomplishments !== null) {
      try {
        const parsed: unknown = JSON.parse(session.accomplishments);
        if (Array.isArray(parsed)) {
          const stringItems = parsed.filter((item): item is string => typeof item === 'string');
          const existing = accomplishmentsByProject.get(project);
          if (existing !== undefined) {
            existing.push(...stringItems);
          }
        }
      } catch {
        // Failed to parse accomplishments, skip this session
      }
    }
  }

  const projectSummaries = Array.from(accomplishmentsByProject.entries())
    .map(([project, accs]) => `${project}: ${accs.join('; ')}`)
    .join('\n');

  const systemPrompt = `Summarize a developer's daily work. Keep the 3-5 most significant items per project.

FORMAT: "feature1, feature2; fixed thing"
- Pick the BIGGEST wins - skip minor fixes, docs, tests, refactoring
- Consolidate related work: "3 notification fixes" → "notification handling"
- Include ALL projects - never omit a project entirely, even if work was minor

Examples:
- "date filtering, new project detection; fixed path resolution"
- "multi-dose scheduling, CSV export"

Use exact project names. Max ~15 words per project.`;

  const userPrompt = `Summarize this developer's day (${date}):\n\n${projectSummaries}`;

  try {
    const { object } = await generateObject({
      model: anthropic(MODEL),
      schema: dailySummarySchema,
      system: systemPrompt,
      prompt: userPrompt,
    });

    // Add isNew flag to projects that are first-time appearances
    const isNewProject = (name: string): boolean => newProjectNames.has(name);

    const result: DailySummaryWithNew = {
      projects: object.projects.map((p) => ({
        ...p,
        isNew: isNewProject(p.name) ? true : undefined,
      })),
    };

    return JSON.stringify(result);
  } catch (error) {
    console.error('Brag summary error:', (error as Error).message);

    // Generate a basic summary on failure
    const projects = Array.from(accomplishmentsByProject.keys()).map(name => ({
      name,
      summary: 'Session details unavailable',
      isNew: newProjectNames.has(name) ? true : undefined,
    }));
    return JSON.stringify({ projects });
  }
}
