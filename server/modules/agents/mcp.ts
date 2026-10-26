/**
 * Registering Probe's MCP server with the user's own Claude Code, so "Probe 열어줘" works in any
 * terminal. This runs the official `claude mcp ...` commands with a fixed argument list; there is
 * no endpoint that runs arbitrary commands.
 *
 * It targets the *system* profile on purpose: that is the Claude Code the user types into. Probe's
 * private profile (data/claude) is only used for Probe's own background jobs.
 */
import { join } from 'node:path';
import { ROOT } from '../../config.ts';
import { unprocessable } from '../../core/errors.ts';
import { MCP_NAME, buildMcpAddArgs, formatCommand, parseMcpGet, stripTerminalEscapes } from './claude-cli.ts';
import { currentClaudeEnv, detectClaude, runClaude } from './service.ts';

export interface McpStatus {
  installed: boolean;
  registered: boolean;
  /** Registered, but pointing at a different install (the Probe folder moved, or a reinstall). */
  stale: boolean;
  /** What registering runs, for display and manual use. */
  command: string;
}

export interface McpResult extends McpStatus {
  ok: boolean;
  /** What the CLI printed, shown in the settings page's output box. */
  output: string;
}

const script = () => join(ROOT, 'mcp', 'server.ts');
const addArgs = () => buildMcpAddArgs({ runtime: process.execPath, script: script(), electron: Boolean(process.versions.electron) });
const env = () => currentClaudeEnv('system');
const clean = (r: { stdout: string; stderr: string }) => stripTerminalEscapes([r.stdout, r.stderr].filter(Boolean).join('\n')).trim();

export async function mcpStatus(): Promise<McpStatus> {
  const command = formatCommand(addArgs());
  if (!(await detectClaude()).installed) return { installed: false, registered: false, stale: false, command };
  const r = await runClaude(['mcp', 'get', MCP_NAME], env());
  const { registered, current } = parseMcpGet(r.code, r.stdout, script());
  return { installed: true, registered, stale: registered && !current, command };
}

/** Register (or re-register, when the old entry points somewhere else). */
export async function installMcp(): Promise<McpResult> {
  const before = await mcpStatus();
  if (!before.installed) throw unprocessable('Claude Code가 설치되어 있지 않습니다');
  let output = '';
  if (before.registered) {
    // `add` refuses a name that exists, so replace it.
    const removed = await runClaude(['mcp', 'remove', '--scope', 'user', MCP_NAME], env());
    output += `$ claude mcp remove --scope user ${MCP_NAME}\n${clean(removed)}\n\n`;
  }
  const r = await runClaude(addArgs(), env());
  output += `$ ${before.command}\n${clean(r)}`;
  return { ...(await mcpStatus()), ok: r.code === 0, output };
}

export async function removeMcp(): Promise<McpResult> {
  const r = await runClaude(['mcp', 'remove', '--scope', 'user', MCP_NAME], env());
  return { ...(await mcpStatus()), ok: r.code === 0, output: `$ claude mcp remove --scope user ${MCP_NAME}\n${clean(r)}` };
}
