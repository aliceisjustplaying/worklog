import { createReadStream } from 'fs';
import * as readline from 'readline';
import type { ParsedSession, ParsedMessage, ToolUse, SessionStats } from '../types';

// Codex JSONL entry types
interface CodexEntry {
  timestamp: string;
  type: 'session_meta' | 'event_msg' | 'response_item' | 'turn_context';
  payload: unknown;
}

interface CodexSessionMeta {
  id: string;
  cwd: string;
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

interface CodexResponseItem {
  type: 'message' | 'function_call' | 'function_call_output' | 'custom_tool_call' | 'reasoning';
  role?: string;
  content?: Array<{ type: string; text?: string }>;
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
async function* parseCodexJSONLStream(
  filePath: string
): AsyncGenerator<CodexEntry> {
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
  let match;
  while ((match = regex.exec(patchContent)) !== null) {
    const filePath = match[1].trim();
    if (filePath && !files.includes(filePath)) {
      files.push(filePath);
    }
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
  return mapping[name] || name;
}

/**
 * Summarize tool input for display (truncate long content)
 */
function summarizeCodexToolInput(name: string, payload: CodexResponseItem): string {
  const MAX_LENGTH = 200;

  if ((name === 'shell' || name === 'shell_command') && payload.arguments) {
    try {
      const args = JSON.parse(payload.arguments);
      const cmd = Array.isArray(args.command) ? args.command.join(' ') : String(args.command || '');
      return truncate(cmd, MAX_LENGTH);
    } catch {
      return truncate(payload.arguments, MAX_LENGTH);
    }
  }

  if (name === 'apply_patch' && payload.input) {
    // Extract first file path from patch
    const files = extractFilesFromPatch(payload.input);
    if (files.length > 0) {
      return files.length === 1 ? files[0] : `${files[0]} (+${files.length - 1} more)`;
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
function extractTextFromContent(content: Array<{ type: string; text?: string }> | undefined): string {
  if (!content || !Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const item of content) {
    if (item.type === 'text' && item.text) {
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

  const filesChanged = new Set<string>();

  for await (const entry of parseCodexJSONLStream(filePath)) {
    // Track timestamps (skip entries without timestamps - common in old format)
    if (entry.timestamp) {
      if (!startTime || entry.timestamp < startTime) startTime = entry.timestamp;
      if (!endTime || entry.timestamp > endTime) endTime = entry.timestamp;
    }

    // Handle session_meta (first line) - new format
    if (entry.type === 'session_meta') {
      const meta = entry.payload as CodexSessionMeta;
      sessionId = meta.id || '';
      gitBranch = meta.git?.branch || '';
      continue;
    }

    // Handle old format first line (pre-October 2025): {id, timestamp, git, ...} without type
    const rawEntry = entry as Record<string, unknown>;
    if (rawEntry.id && !rawEntry.type && rawEntry.git) {
      sessionId = rawEntry.id as string;
      gitBranch = (rawEntry.git as Record<string, unknown>)?.branch as string || '';
      continue;
    }

    // Handle event_msg (user/assistant text messages)
    if (entry.type === 'event_msg') {
      const payload = entry.payload as CodexEventMsg;

      if (payload.type === 'user_message') {
        userMessages++;
        messages.push({
          type: 'user',
          timestamp: entry.timestamp,
          text: payload.message || '',
          toolUses: [],
        });
      } else if (payload.type === 'agent_message') {
        assistantMessages++;
        messages.push({
          type: 'assistant',
          timestamp: entry.timestamp,
          text: payload.message || '',
          toolUses: [],
        });
      } else if (payload.type === 'token_count' && payload.info?.total_token_usage) {
        // Track final token counts (total_token_usage accumulates)
        const usage = payload.info.total_token_usage;
        totalInputTokens = usage.input_tokens + (usage.cached_input_tokens || 0);
        totalOutputTokens = usage.output_tokens + (usage.reasoning_output_tokens || 0);
      }
      continue;
    }

    // Handle response_item (function calls and custom tool calls)
    if (entry.type === 'response_item') {
      const payload = entry.payload as CodexResponseItem;

      // Function calls and custom tool calls (equivalent to Claude tool_use)
      if ((payload.type === 'function_call' || payload.type === 'custom_tool_call') && payload.name) {
        const mappedName = mapCodexToolName(payload.name);
        toolCalls[mappedName] = (toolCalls[mappedName] || 0) + 1;

        // Extract files from apply_patch
        if (payload.name === 'apply_patch' && payload.input) {
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
          timestamp: entry.timestamp,
          text: '',
          toolUses: [toolUse],
        });
      }

      // Agent text messages from response_item
      if (payload.type === 'message' && payload.role === 'assistant' && payload.content) {
        const text = extractTextFromContent(payload.content);
        if (text) {
          assistantMessages++;
          messages.push({
            type: 'assistant',
            timestamp: entry.timestamp,
            text,
            toolUses: [],
          });
        }
      }
    }

    // Handle old format: top-level function_call (pre-October 2025)
    // Old format: {"type":"function_call","name":"shell","arguments":"{\"command\":[\"bash\",\"-lc\",\"apply_patch...\"]}"}
    if (entry.type === 'function_call' && (entry as Record<string, unknown>).name) {
      const oldEntry = entry as Record<string, unknown>;
      const name = oldEntry.name as string;
      const argsStr = oldEntry.arguments as string;

      // Check if this is a shell command containing apply_patch
      if (name === 'shell' && argsStr) {
        try {
          const args = JSON.parse(argsStr);
          const command = args.command;
          if (Array.isArray(command) && command.length >= 3) {
            const shellCmd = command[2] as string;
            if (shellCmd?.includes('apply_patch')) {
              // Extract the patch content from the heredoc
              const patchMatch = shellCmd.match(/apply_patch\s*<<\s*['"]?PATCH['"]?\n([\s\S]*?)\n\s*PATCH/);
              if (patchMatch) {
                toolCalls['Edit'] = (toolCalls['Edit'] || 0) + 1;
                const files = extractFilesFromPatch(patchMatch[1]);
                files.forEach((f) => filesChanged.add(f));

                assistantMessages++;
                messages.push({
                  type: 'assistant',
                  timestamp: (oldEntry.timestamp as string) || '',
                  text: '',
                  toolUses: [{
                    name: 'Edit',
                    input: `apply_patch: ${files.join(', ') || 'file changes'}`,
                    rawInput: oldEntry,
                  }],
                });
              }
            } else {
              // Regular shell command
              toolCalls['Bash'] = (toolCalls['Bash'] || 0) + 1;
              assistantMessages++;
              messages.push({
                type: 'assistant',
                timestamp: (oldEntry.timestamp as string) || '',
                text: '',
                toolUses: [{
                  name: 'Bash',
                  input: shellCmd?.substring(0, 100) || 'shell command',
                  rawInput: oldEntry,
                }],
              });
            }
          }
        } catch {
          // Invalid JSON in arguments
        }
      }
    }
  }

  // Fallback to filename for sessionId
  if (!sessionId) {
    sessionId = filePath.split('/').pop()?.replace('.jsonl', '') || 'unknown';
  }

  // Provide default timestamps if none found
  const now = new Date().toISOString();
  if (!startTime) startTime = now;
  if (!endTime) endTime = startTime;

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
