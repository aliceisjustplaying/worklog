import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
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

/**
 * Generate a summary for a session using Claude
 */
export async function summarizeSession(
  session: ParsedSession
): Promise<SessionSummary> {
  const transcript = createCondensedTranscript(session);

  const systemPrompt = `You are summarizing a Claude Code coding session for a daily worklog.
Focus on: what was accomplished, problems solved, features built or bugs fixed.
Be concise but specific about the actual work done.

Output valid JSON with this exact structure:
{
  "shortSummary": "1-2 sentence summary of what was accomplished",
  "accomplishments": ["bullet point 1", "bullet point 2", ...],
  "filesChanged": ["file1.ts", "file2.ts", ...],
  "toolsUsed": ["Bash", "Edit", ...]
}

Keep accomplishments focused on outcomes, not process. If very little was done (just exploration or questions), say so briefly.`;

  const userPrompt = `Summarize this Claude Code session:\n\n${transcript}`;

  try {
    const { text } = await generateText({
      model: anthropic(MODEL),
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 1024,
    });

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ||
      text.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const summary = JSON.parse(jsonStr) as SessionSummary;

    // Validate and provide defaults
    return {
      shortSummary: summary.shortSummary || 'Session completed',
      accomplishments: Array.isArray(summary.accomplishments)
        ? summary.accomplishments
        : [],
      filesChanged: Array.isArray(summary.filesChanged)
        ? summary.filesChanged
        : [],
      toolsUsed: Array.isArray(summary.toolsUsed)
        ? summary.toolsUsed
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

/**
 * Generate a daily brag summary from multiple session summaries
 */
export async function generateDailyBragSummary(
  date: string,
  sessions: DBSessionSummary[]
): Promise<string> {
  if (sessions.length === 0) {
    return 'No sessions recorded';
  }

  // Collect all accomplishments
  const allAccomplishments: string[] = [];
  const projectNames = new Set<string>();

  for (const session of sessions) {
    projectNames.add(session.project_name);
    try {
      const accomplishments = JSON.parse(session.accomplishments || '[]');
      allAccomplishments.push(...accomplishments);
    } catch {
      // Skip invalid JSON
    }
  }

  const systemPrompt = `You are writing a brief, impressive summary of a developer's daily work for sharing on social media.
Keep it short (1-3 sentences), punchy, and focused on impact.
Don't use hashtags or emojis unless they really fit.
Make it sound natural, not like AI-generated content.
Focus on the most impressive or interesting accomplishments.`;

  const userPrompt = `Summarize this developer's day (${date}):

Projects worked on: ${Array.from(projectNames).join(', ')}
Number of sessions: ${sessions.length}

Accomplishments:
${allAccomplishments.map((a) => `- ${a}`).join('\n')}

Write a brief, impressive summary for social media.`;

  try {
    const { text } = await generateText({
      model: anthropic(MODEL),
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 256,
    });

    return text.trim() || 'Productive coding day!';
  } catch (error) {
    console.error('Brag summary error:', error);

    // Generate a basic summary on failure
    const projectList = Array.from(projectNames).slice(0, 3).join(', ');
    return `Worked on ${projectList}. ${sessions.length} coding sessions, making solid progress.`;
  }
}
