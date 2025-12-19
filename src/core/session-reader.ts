import { createReadStream } from 'fs';
import * as readline from 'readline';
import type {
  RawSessionEntry,
  ParsedSession,
  ParsedMessage,
  ToolUse,
  SessionStats,
  MessageContent,
} from '../types';

/**
 * Stream-parse a JSONL session file
 */
export async function* parseJSONLStream(
  filePath: string
): AsyncGenerator<RawSessionEntry> {
  const rl = readline.createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as RawSessionEntry;
    } catch {
      // Skip invalid JSON lines
    }
  }
}

/**
 * Parse a session file into a structured format
 */
export async function parseSessionFile(
  filePath: string,
  projectPath: string,
  projectName: string
): Promise<ParsedSession> {
  const messages: ParsedMessage[] = [];
  const toolCalls: Record<string, number> = {};
  let sessionId = '';
  let gitBranch = '';
  let startTime = '';
  let endTime = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let userMessages = 0;
  let assistantMessages = 0;

  const seen = new Set<string>();

  for await (const entry of parseJSONLStream(filePath)) {
    // Deduplication - use uuid (unique per chunk) not message.id (same across streaming chunks)
    if (seen.has(entry.uuid)) continue;
    seen.add(entry.uuid);

    // Extract metadata from first entry
    if (!sessionId && entry.sessionId) {
      sessionId = entry.sessionId;
    }
    if (!gitBranch && entry.gitBranch) {
      gitBranch = entry.gitBranch;
    }

    // Track timestamps
    if (!startTime || entry.timestamp < startTime) {
      startTime = entry.timestamp;
    }
    if (!endTime || entry.timestamp > endTime) {
      endTime = entry.timestamp;
    }

    // Extract token usage from assistant messages
    if (entry.type === 'assistant' && entry.message?.usage) {
      const usage = entry.message.usage;
      totalInputTokens += usage.input_tokens || 0;
      totalOutputTokens += usage.output_tokens || 0;
      totalInputTokens += usage.cache_creation_input_tokens || 0;
      totalInputTokens += usage.cache_read_input_tokens || 0;
    }

    // Parse message content
    const text = extractText(entry.message?.content);
    const toolUses = extractToolUses(entry.message?.content);

    // Count tool calls
    for (const tool of toolUses) {
      toolCalls[tool.name] = (toolCalls[tool.name] || 0) + 1;
    }

    if (entry.type === 'user') userMessages++;
    if (entry.type === 'assistant') assistantMessages++;

    messages.push({
      type: entry.type,
      timestamp: entry.timestamp,
      text,
      toolUses,
    });
  }

  // Use filename as sessionId fallback
  if (!sessionId) {
    sessionId = filePath.split('/').pop()?.replace('.jsonl', '') || 'unknown';
  }

  // Provide default timestamps if none found
  const now = new Date().toISOString();
  if (!startTime) {
    startTime = now;
  }
  if (!endTime) {
    endTime = startTime;
  }

  // Derive date from startTime
  const date = startTime.split('T')[0];

  const stats: SessionStats = {
    userMessages,
    assistantMessages,
    toolCalls,
    totalInputTokens,
    totalOutputTokens,
  };

  return {
    sessionId,
    filePath,
    projectPath,
    projectName,
    gitBranch,
    startTime,
    endTime,
    date,
    messages,
    stats,
  };
}

/**
 * Extract text from message content array
 */
function extractText(content: MessageContent[] | undefined): string {
  if (!content || !Array.isArray(content)) return '';

  const texts: string[] = [];
  for (const item of content) {
    if (item.type === 'text') {
      // Handle both formats: { text: "..." } and { content: "..." }
      const text = 'text' in item ? item.text : 'content' in item ? item.content : '';
      if (text) texts.push(text);
    }
  }
  return texts.join('\n');
}

/**
 * Extract tool uses from message content
 */
function extractToolUses(content: MessageContent[] | undefined): ToolUse[] {
  if (!content || !Array.isArray(content)) return [];

  const tools: ToolUse[] = [];
  for (const item of content) {
    if (item.type === 'tool_use') {
      tools.push({
        name: item.name,
        input: summarizeToolInput(item.name, item.input),
        rawInput: item.input,
      });
    }
  }
  return tools;
}

/**
 * Summarize tool input for display (truncate long content)
 */
function summarizeToolInput(
  toolName: string,
  input: Record<string, unknown>
): string {
  const MAX_LENGTH = 200;

  switch (toolName) {
    case 'Bash':
      return truncate(String(input.command || ''), MAX_LENGTH);
    case 'Read':
      return truncate(String(input.file_path || ''), MAX_LENGTH);
    case 'Write':
    case 'Edit':
      return truncate(String(input.file_path || ''), MAX_LENGTH);
    case 'Glob':
      return truncate(String(input.pattern || ''), MAX_LENGTH);
    case 'Grep':
      return truncate(String(input.pattern || ''), MAX_LENGTH);
    case 'Task':
      return truncate(String(input.description || ''), MAX_LENGTH);
    default:
      return truncate(JSON.stringify(input), MAX_LENGTH);
  }
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Create a condensed transcript for LLM summarization
 * Leads with action summary (files changed) to ensure implementation work is captured
 */
export function createCondensedTranscript(session: ParsedSession): string {
  const parts: string[] = [];

  parts.push(`Project: ${session.projectName}`);
  if (session.gitBranch) {
    parts.push(`Branch: ${session.gitBranch}`);
  }
  parts.push(`Duration: ${formatDuration(session.startTime, session.endTime)}`);
  parts.push('');

  // LEAD with files changed - this is the most important signal of actual work
  const filesWritten: string[] = [];
  const filesEdited: string[] = [];
  const commandsRun: string[] = [];

  for (const msg of session.messages) {
    if (msg.type === 'assistant') {
      for (const tool of msg.toolUses) {
        if (tool.name === 'Write') {
          const path = String((tool.rawInput as any)?.file_path || '');
          if (path && !filesWritten.includes(path)) {
            filesWritten.push(path);
          }
        } else if (tool.name === 'Edit') {
          const path = String((tool.rawInput as any)?.file_path || '');
          if (path && !filesEdited.includes(path)) {
            filesEdited.push(path);
          }
        } else if (tool.name === 'Bash') {
          const cmd = String((tool.rawInput as any)?.command || '').slice(0, 100);
          if (cmd && commandsRun.length < 10) {
            commandsRun.push(cmd);
          }
        }
      }
    }
  }

  // Show action summary at the TOP
  if (filesWritten.length > 0) {
    parts.push(`FILES CREATED (${filesWritten.length}):`);
    filesWritten.slice(0, 15).forEach(f => parts.push(`  - ${f}`));
    if (filesWritten.length > 15) parts.push(`  ... and ${filesWritten.length - 15} more`);
    parts.push('');
  }

  if (filesEdited.length > 0) {
    parts.push(`FILES EDITED (${filesEdited.length}):`);
    filesEdited.slice(0, 15).forEach(f => parts.push(`  - ${f}`));
    if (filesEdited.length > 15) parts.push(`  ... and ${filesEdited.length - 15} more`);
    parts.push('');
  }

  if (commandsRun.length > 0) {
    parts.push(`COMMANDS RUN (${commandsRun.length}):`);
    commandsRun.slice(0, 5).forEach(c => parts.push(`  $ ${c}`));
    parts.push('');
  }

  // Then show conversation context (but less of it)
  parts.push('CONVERSATION:');
  let messageCount = 0;
  for (const msg of session.messages) {
    if (messageCount > 20) break; // Limit to avoid overwhelming

    if (msg.type === 'user' && msg.text) {
      const text = msg.text.slice(0, 300);
      parts.push(`User: ${text}`);
      messageCount++;
    } else if (msg.type === 'assistant' && msg.text) {
      const text = msg.text.slice(0, 200);
      parts.push(`Assistant: ${text}`);
      messageCount++;
    }
  }

  // Add stats at end
  parts.push('');
  const toolSummary = Object.entries(session.stats.toolCalls)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `${name}(${count})`)
    .join(', ');
  if (toolSummary) {
    parts.push(`Tool usage: ${toolSummary}`);
  }

  return parts.join('\n');
}

function formatDuration(start: string, end: string): string {
  if (!start || !end) return 'unknown';

  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
