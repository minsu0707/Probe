/** Reading `claude -p --output-format stream-json`: one JSON object per stdout line. */
import { basename } from 'node:path';
import type { ClaudeUsage } from '../../../shared/models.ts';
import { toolLabel } from '../../../shared/tool-labels.ts';
import { parseRateLimit } from '../agents/claude-cli.ts';

export type StreamEvent =
  /** Claude started using a tool; `text` is a Korean one-liner for the progress log. */
  | { kind: 'progress'; text: string }
  /** The final result. `ok` is false when Claude reported an error. */
  | { kind: 'result'; ok: boolean; text: string }
  /** Something Claude said (conversations show it; the learning job ignores it). */
  | { kind: 'text'; text: string }
  /** The CLI created or resumed its session; from here the session id is valid. */
  | { kind: 'init' }
  /** Account usage, to show in the status bar. */
  | { kind: 'usage'; usage: ClaudeUsage };

/** A line that isn't JSON (stray warnings) yields no events rather than an error. */
export function parseStreamLine(line: string): StreamEvent[] {
  if (!line.trim()) return [];
  let ev: any;
  try {
    ev = JSON.parse(line);
  } catch {
    return [];
  }

  if (ev.type === 'system' && ev.subtype === 'init') return [{ kind: 'init' }];
  if (ev.type === 'rate_limit_event') {
    const usage = parseRateLimit(ev);
    return usage ? [{ kind: 'usage', usage }] : [];
  }
  if (ev.type === 'assistant') {
    // Blocks keep their order: Claude often says what it will do, then does it.
    return (ev.message?.content ?? []).flatMap((block: any): StreamEvent[] => {
      if (block.type === 'tool_use') return [{ kind: 'progress', text: describeTool(block.name, block.input) }];
      if (block.type === 'text' && String(block.text).trim()) return [{ kind: 'text', text: String(block.text) }];
      return [];
    });
  }
  if (ev.type === 'result') {
    return [{ kind: 'result', ok: !ev.is_error, text: String(ev.result ?? (ev.is_error ? 'Claude reported an error' : '')) }];
  }
  return [];
}

export function describeTool(name: string, input: any): string {
  const target = String(input?.file_path ?? input?.path ?? input?.pattern ?? '');
  if (name === 'Read') return `읽는 중: ${basename(target)}`;
  if (name === 'Write' || name === 'Edit') return `작성 중: ${basename(target)}`;
  if (name === 'Glob' || name === 'Grep') return `자료 찾는 중: ${target}`;
  if (name.startsWith('mcp__') && name.includes('Drive')) return `Google Drive에서 읽는 중 (${name.split('__').pop()})`;
  const STATUS: Record<string, string> = { candidate: '확인 필요', confirmed: '확정', false_positive: '오탐', fixed: '수정됨' };
  if (name === 'mcp__probe__update_defect' && input?.status) return `결함 상태 변경: ${STATUS[input.status] ?? input.status}`;
  if (name === 'Bash' && input?.command) return `명령 실행: ${String(input.command).split('\n')[0].slice(0, 80)}`;
  return toolLabel(name) ?? name;
}
