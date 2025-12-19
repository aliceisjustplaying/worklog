import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { ParsedSession, SessionSummary, DBSessionSummary } from '../types';
import { createCondensedTranscript } from './session-reader';

const anthropic = createAnthropic({
  apiKey: process.env.WORKLOG_API_KEY,
  ...(process.env.WORKLOG_BASE_URL && { baseURL: process.env.WORKLOG_BASE_URL }),
  headers: {
    'Accept-Encoding': 'identity',
  },
});

const MODEL = process.env.SUMMARIZER_MODEL || 'claude-haiku-4-5-20251001';

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
      maxTokens: 1024,
      mode: 'tool', // Force tool use mode for reliable structured output
    });

    return {
      shortSummary: object.shortSummary || 'Session completed',
      accomplishments: object.accomplishments || [],
      filesChanged: object.filesChanged || [],
      toolsUsed: object.toolsUsed.length > 0
        ? object.toolsUsed
        : Object.keys(session.stats.toolCalls),
    };
  } catch (error) {
    // Haiku sometimes returns malformed output - just use fallback
    // Return a basic summary on failure
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

export type DailySummary = z.infer<typeof dailySummarySchema>;

/**
 * Generate a daily summary from multiple session summaries
 * Returns structured data for easy rendering
 */
export async function generateDailyBragSummary(
  date: string,
  sessions: DBSessionSummary[]
): Promise<string> {
  if (sessions.length === 0) {
    return JSON.stringify({ projects: [] });
  }

  // Group accomplishments by project
  const accomplishmentsByProject = new Map<string, string[]>();
  for (const session of sessions) {
    const project = session.project_name;
    if (!accomplishmentsByProject.has(project)) {
      accomplishmentsByProject.set(project, []);
    }
    try {
      const acc = JSON.parse(session.accomplishments || '[]');
      accomplishmentsByProject.get(project)!.push(...acc);
    } catch {}
  }

  const projectSummaries = Array.from(accomplishmentsByProject.entries())
    .map(([project, accs]) => `${project}: ${accs.join('; ')}`)
    .join('\n');

  const systemPrompt = `Summarize a developer's daily work. Be EXTREMELY brief.

FORMAT: "added [feature] ([scope])" or "fixed [thing] ([scope])"
- Scope is just: frontend, backend, or both
- ONE feature per project, maybe two if truly separate

CONSOLIDATE aggressively:
- "frequency UI; dose calculations; CSV updates" → "multi-dose scheduling (backend, frontend)"
- "dark mode fixes; theme updates; color changes" → "dark mode (frontend)"
- "tests; error handling; refactoring" → skip unless it's the ONLY work done

Do NOT list:
- Tests (unless the whole session was just tests)
- Types/refactoring
- Documentation updates
- Individual files or components

GOOD: "added multi-dose scheduling (backend, frontend)"
BAD: "multi-dose scheduling engine with formulation matching (backend, types), dose frequency UI..."

Use exact project names. Max 10 words per project.`;

  const userPrompt = `Summarize this developer's day (${date}):\n\n${projectSummaries}`;

  try {
    const { object } = await generateObject({
      model: anthropic(MODEL),
      schema: dailySummarySchema,
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 512,
      mode: 'tool', // Force tool use mode for reliable structured output
    });

    return JSON.stringify(object);
  } catch (error) {
    console.error('Brag summary error:', (error as Error).message);

    // Generate a basic summary on failure
    const projects = Array.from(accomplishmentsByProject.keys()).map(name => ({
      name,
      summary: 'Session details unavailable',
    }));
    return JSON.stringify({ projects });
  }
}
