/** Reading `claude -p --output-format stream-json`: one JSON object per stdout line. */
import { basename } from 'node:path';

export type StreamEvent =
  /** Claude started using a tool; `text` is a Korean one-liner for the progress log. */
  | { kind: 'progress'; text: string }
  /** The final result. `ok` is false when Claude reported an error. */
  | { kind: 'result'; ok: boolean; text: string };

/** A line that isn't JSON (stray warnings) yields no events rather than an error. */
export function parseStreamLine(line: string): StreamEvent[] {
  if (!line.trim()) return [];
  let ev: any;
  try {
    ev = JSON.parse(line);
  } catch {
    return [];
  }

  if (ev.type === 'assistant') {
    return (ev.message?.content ?? []).filter((block: any) => block.type === 'tool_use').map((block: any) => ({ kind: 'progress', text: describeTool(block.name, block.input) }) as StreamEvent);
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
  return name;
}
