import { createReadStream } from 'fs';
import * as readline from 'readline';

import type { ParsedMessage, ParsedSession, SessionStats, ToolUse } from '../types';

// Codex JSONL entry types
interface CodexEntry {
  timestamp?: string;
  type: 'session_meta' | 'event_msg' | 'response_item' | 'turn_context' | 'message' | 'function_call';
  payload: unknown;
}

interface CodexSessionMeta {
  id?: string;
  cwd?: string;
  cli_version?: string;
  model_provider?: string;
  git?: {
    branch: string;
    commit_hash?: string;
    repository_url?: string;
  };
}

interface CodexEventMsg {
  type: 'user_message' | 'agent_message' | 'agent_reasoning' | 'token_count';
  message?: string;
  info?: {
    total_token_usage?: {
      input_tokens: number;
      output_tokens: number;
      cached_input_tokens?: number;
      reasoning_output_tokens?: number;
    };
  };
}

interface CodexContentItem {
  type: string;
  text?: string;
}

interface CodexResponseItem {
  type: 'message' | 'function_call' | 'function_call_output' | 'custom_tool_call' | 'reasoning';
  role?: string;
  content?: CodexContentItem[];
  name?: string;
  input?: string; // For function_call/custom_tool_call (apply_patch content)
  arguments?: string; // For function_call (shell args as JSON)
  call_id?: string;
  output?: string;
  status?: string; // For custom_tool_call
}

/**
 * Get the "effective date" for a timestamp using a 3am boundary.
 * Work done before 3am counts as the previous day (aligns with sleep cycle).
 */
function getEffectiveDate(timestamp: string): string {
  const d = new Date(timestamp);
  d.setHours(d.getHours() - 3);
  return d.toISOString().split('T')[0];
}

/**
 * Stream-parse a Codex JSONL session file
 */
async function* parseCodexJSONLStream(filePath: string): AsyncGenerator<CodexEntry> {
  const rl = readline.createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as CodexEntry;
    } catch {
      // Skip invalid JSON lines
    }
  }
}

/**
 * Extract file paths from apply_patch unified diff format
 * Format: "*** Add File: path" or "*** Update File: path" or "*** Delete File: path"
 */
function extractFilesFromPatch(patchContent: string): string[] {
  const files: string[] = [];
  const regex = /\*\*\* (?:Add|Update|Delete) File:\s*(.+)/g;
  let match = regex.exec(patchContent);
  while (match !== null) {
    const filePath = match[1].trim();
    if (filePath !== '' && !files.includes(filePath)) {
      files.push(filePath);
    }
    match = regex.exec(patchContent);
  }
  return files;
}

/**
 * Map Codex tool names to Claude-equivalent names for consistent tracking
 */
function mapCodexToolName(name: string): string {
  const mapping: Record<string, string> = {
    shell: 'Bash',
    shell_command: 'Bash',
    apply_patch: 'Edit',
    update_plan: 'TodoWrite',
  };
  return mapping[name] ?? name;
}

interface ShellArgs {
  command?: unknown;
}

/**
 * Summarize tool input for display (truncate long content)
 */
function summarizeCodexToolInput(name: string, payload: CodexResponseItem): string {
  const MAX_LENGTH = 200;

  if ((name === 'shell' || name === 'shell_command') && payload.arguments !== undefined) {
    try {
      const args = JSON.parse(payload.arguments) as ShellArgs;
      let cmd = '';
      if (Array.isArray(args.command)) {
        cmd = args.command.join(' ');
      } else if (
        typeof args.command === 'string' ||
        typeof args.command === 'number' ||
        typeof args.command === 'boolean'
      ) {
        cmd = String(args.command);
      }
      return truncate(cmd, MAX_LENGTH);
    } catch {
      return truncate(payload.arguments, MAX_LENGTH);
    }
  }

  if (name === 'apply_patch' && payload.input !== undefined) {
    // Extract first file path from patch
    const files = extractFilesFromPatch(payload.input);
    if (files.length > 0) {
      const additionalFiles = files.length - 1;
      return files.length === 1 ? files[0] : `${files[0]} (+${additionalFiles.toString()} more)`;
    }
    return truncate(payload.input, MAX_LENGTH);
  }

  return '';
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Extract text content from Codex message content array
 */
function extractTextFromContent(content: CodexContentItem[] | undefined): string {
  if (content === undefined || !Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const item of content) {
    // Handle both new format ('text') and old format ('input_text', 'output_text')
    if (
      (item.type === 'text' || item.type === 'input_text' || item.type === 'output_text') &&
      item.text !== undefined
    ) {
      texts.push(item.text);
    }
  }
  return texts.join('\n');
}

/**
 * Parse a Codex session file into the unified ParsedSession format
 */
export async function parseCodexSessionFile(
  filePath: string,
  projectPath: string,
  projectName: string,
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

  const filesChanged = new Set<string>();

  for await (const entry of parseCodexJSONLStream(filePath)) {
    // Track timestamps (skip entries without timestamps - common in old format)
    if (entry.timestamp !== undefined && entry.timestamp !== '') {
      if (startTime === '' || entry.timestamp < startTime) startTime = entry.timestamp;
      if (endTime === '' || entry.timestamp > endTime) endTime = entry.timestamp;
    }

    // Handle session_meta (first line) - new format
    if (entry.type === 'session_meta') {
      const meta = entry.payload as CodexSessionMeta;
      sessionId = meta.id ?? '';
      gitBranch = meta.git !== undefined ? meta.git.branch : '';
      continue;
    }

    // Handle old format first line (pre-October 2025): {id, timestamp, git, ...} without type
    const rawEntry = entry as unknown as Record<string, unknown>;
    if (rawEntry.id !== undefined && rawEntry.type === undefined && rawEntry.git !== undefined) {
      sessionId = rawEntry.id as string;
      const git = rawEntry.git as Record<string, unknown>;
      gitBranch = git.branch !== undefined ? (git.branch as string) : '';
      continue;
    }

    // Handle event_msg (user/assistant text messages)
    if (entry.type === 'event_msg') {
      const payload = entry.payload as CodexEventMsg;

      if (payload.type === 'user_message') {
        userMessages++;
        messages.push({
          type: 'user',
          timestamp: entry.timestamp ?? '',
          text: payload.message ?? '',
          toolUses: [],
        });
      } else if (payload.type === 'agent_message') {
        assistantMessages++;
        messages.push({
          type: 'assistant',
          timestamp: entry.timestamp ?? '',
          text: payload.message ?? '',
          toolUses: [],
        });
      } else if (payload.type === 'token_count' && payload.info?.total_token_usage !== undefined) {
        // Track final token counts (total_token_usage accumulates)
        const usage = payload.info.total_token_usage;
        totalInputTokens = usage.input_tokens + (usage.cached_input_tokens ?? 0);
        totalOutputTokens = usage.output_tokens + (usage.reasoning_output_tokens ?? 0);
      }
      continue;
    }

    // Handle response_item (function calls and custom tool calls)
    if (entry.type === 'response_item') {
      const payload = entry.payload as CodexResponseItem;

      // Function calls and custom tool calls (equivalent to Claude tool_use)
      if ((payload.type === 'function_call' || payload.type === 'custom_tool_call') && payload.name !== undefined) {
        const mappedName = mapCodexToolName(payload.name);
        toolCalls[mappedName] = (toolCalls[mappedName] ?? 0) + 1;

        // Extract files from apply_patch
        if (payload.name === 'apply_patch' && payload.input !== undefined) {
          const files = extractFilesFromPatch(payload.input);
          files.forEach((f) => filesChanged.add(f));
        }

        const toolUse: ToolUse = {
          name: mappedName,
          input: summarizeCodexToolInput(payload.name, payload),
          rawInput: payload as unknown as Record<string, unknown>,
        };

        // Add as assistant message with tool use
        assistantMessages++;
        messages.push({
          type: 'assistant',
          timestamp: entry.timestamp ?? '',
          text: '',
          toolUses: [toolUse],
        });
      }

      // Agent text messages from response_item
      if (payload.type === 'message' && payload.role === 'assistant' && payload.content !== undefined) {
        const text = extractTextFromContent(payload.content);
        if (text !== '') {
          assistantMessages++;
          messages.push({
            type: 'assistant',
            timestamp: entry.timestamp ?? '',
            text,
            toolUses: [],
          });
        }
      }
    }

    // Handle old format: top-level function_call (pre-October 2025)
    // Old format: {"type":"function_call","name":"shell","arguments":"{\"command\":[\"bash\",\"-lc\",\"apply_patch...\"]}"}
    if (entry.type === 'function_call' && (entry as unknown as Record<string, unknown>).name !== undefined) {
      const oldEntry = entry as unknown as Record<string, unknown>;
      const name = oldEntry.name as string;
      const argsStr = oldEntry.arguments as string | undefined;

      // Check if this is a shell command containing apply_patch
      if (name === 'shell' && argsStr !== undefined) {
        try {
          const args = JSON.parse(argsStr) as ShellArgs;
          const command = args.command;
          if (Array.isArray(command) && command.length >= 3) {
            const shellCmd = command[2] as string;
            const patchRegex = /apply_patch\s*<<\s*['"]?PATCH['"]?\n([\s\S]*?)\n\s*PATCH/;
            const patchMatch = patchRegex.exec(shellCmd);
            if (shellCmd.includes('apply_patch') && patchMatch !== null) {
              // Extract the patch content from the heredoc
              toolCalls.Edit = ('Edit' in toolCalls ? toolCalls.Edit : 0) + 1;
              const files = extractFilesFromPatch(patchMatch[1]);
              files.forEach((f) => filesChanged.add(f));

              assistantMessages++;
              messages.push({
                type: 'assistant',
                timestamp: (oldEntry.timestamp as string | undefined) ?? '',
                text: '',
                toolUses: [
                  {
                    name: 'Edit',
                    input: `apply_patch: ${files.join(', ') !== '' ? files.join(', ') : 'file changes'}`,
                    rawInput: oldEntry,
                  },
                ],
              });
            } else {
              // Regular shell command
              toolCalls.Bash = ('Bash' in toolCalls ? toolCalls.Bash : 0) + 1;
              assistantMessages++;
              messages.push({
                type: 'assistant',
                timestamp: (oldEntry.timestamp as string | undefined) ?? '',
                text: '',
                toolUses: [
                  {
                    name: 'Bash',
                    input: shellCmd.substring(0, 100),
                    rawInput: oldEntry,
                  },
                ],
              });
            }
          }
        } catch {
          // Invalid JSON in arguments
        }
      }
    }

    // Handle old format: top-level message (pre-October 2025)
    // Old format: {"type":"message","role":"user/assistant","content":[{"type":"input_text/output_text","text":"..."}]}
    if (entry.type === 'message') {
      const msgEntry = entry as unknown as {
        type: string;
        role: string;
        content?: CodexContentItem[];
        timestamp?: string;
      };
      const text = extractTextFromContent(msgEntry.content);

      // Skip environment_context messages (just contain cwd/approval policy info)
      if (text !== '' && !text.includes('<environment_context>')) {
        if (msgEntry.role === 'user') {
          userMessages++;
          messages.push({
            type: 'user',
            timestamp: msgEntry.timestamp ?? '',
            text,
            toolUses: [],
          });
        } else if (msgEntry.role === 'assistant') {
          assistantMessages++;
          messages.push({
            type: 'assistant',
            timestamp: msgEntry.timestamp ?? '',
            text,
            toolUses: [],
          });
        }
      }
    }
  }

  // Fallback to filename for sessionId
  if (sessionId === '') {
    const filename = filePath.split('/').pop();
    sessionId = filename?.replace('.jsonl', '') ?? 'unknown';
  }

  // Provide default timestamps if none found
  const now = new Date().toISOString();
  if (startTime === '') startTime = now;
  if (endTime === '') endTime = startTime;

  // Derive date from endTime with 3am boundary
  const date = getEffectiveDate(endTime);

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
