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
    .describe('1-2 sentence summary of what was BUILT, FIXED, or CHANGED. Never mention reading/exploring.'),
  accomplishments: z
    .array(z.string())
    .describe('List of concrete outcomes only: features built, bugs fixed, code written. Never include exploration or research.'),
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

  const systemPrompt = `You summarize Claude Code sessions for a worklog.
Focus ONLY on outcomes: features built, bugs fixed, code written, problems solved.
Never mention exploration, reading code, or research as accomplishments - those are not work.
If files were edited, describe what was changed and why.`;

  const userPrompt = `Summarize this Claude Code session:\n\n${transcript}`;

  try {
    const { object } = await generateObject({
      model: anthropic(MODEL),
      schema: sessionSummarySchema,
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 1024,
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
    console.error('Summarization error:', error);

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
      summary: z.string().describe('Very brief OUTCOMES only, 5-10 words max, like "fixed auth bug, added tests". Never mention exploration.'),
    }))
    .describe('List of projects with brief outcome summaries'),
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

  const systemPrompt = `Summarize a developer's daily work by project.
Keep each project summary VERY brief: 5-10 words max, like "fixed auth bug, added user settings".
Focus on OUTCOMES only: what was built, fixed, or changed. Not what was read or explored.
Comma-separated phrases, not full sentences. Use action verbs: built, fixed, added, refactored.
IMPORTANT: Use the exact project names given - do not rename or paraphrase them.`;

  const userPrompt = `Summarize this developer's day (${date}):\n\n${projectSummaries}`;

  try {
    const { object } = await generateObject({
      model: anthropic(MODEL),
      schema: dailySummarySchema,
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 512,
    });

    return JSON.stringify(object);
  } catch (error) {
    console.error('Brag summary error:', error);

    // Generate a basic summary on failure
    const projects = Array.from(accomplishmentsByProject.keys()).map(name => ({
      name,
      summary: 'Session details unavailable',
    }));
    return JSON.stringify({ projects });
  }
}
