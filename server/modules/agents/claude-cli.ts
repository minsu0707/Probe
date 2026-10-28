/**
 * Pure helpers around the `claude` command line: building its environment and reading what it
 * prints. No process is started here, so the parsing is tested against real captured output.
 */
import { join } from 'node:path';
import { usageWindow, type ClaudeAuth, type ClaudeProfile, type ClaudeUsage } from '../../../shared/models.ts';
import { envWithoutElectronFlag } from '../../core/process.ts';

/**
 * What a background Claude job may use. Nobody is there to approve a prompt in a headless run,
 * so the list is explicit: file tools and the Drive connector are allowed; shell and web access
 * are denied because Probe's jobs only read documents and write Markdown or test files.
 * Shown read-only in Settings → Agents.
 */
export const BACKGROUND_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'mcp__claude_ai_Google_Drive'];
/** Added for chat sessions only: starting a run through Probe's own MCP server, and reading its defects. */
export const SESSION_EXTRA_TOOLS = ['mcp__probe__run_tests', 'mcp__probe__list_defects', 'mcp__probe__update_defect', 'mcp__probe__delete_defect'];
export const BACKGROUND_DENIED_TOOLS = ['Bash', 'WebFetch', 'WebSearch'];

/**
 * Environment for a `claude` child.
 *  - 'probe':  a config folder owned by Probe, so its login, settings, hooks and MCP servers are
 *              separate from the user's own Claude Code. Jobs behave the same on every machine.
 *  - 'system': whatever the environment already provides (the user's existing login).
 */
export function claudeEnv(profile: ClaudeProfile, probeHome: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = envWithoutElectronFlag(base);
  if (profile === 'probe') env.CLAUDE_CONFIG_DIR = join(probeHome, 'claude');
  return env;
}

/**
 * The CLI wraps its URL in OSC 8 hyperlink escapes (ESC ] 8 ; ; url ESC \ text ESC ] 8 ; ; ESC \)
 * and may colour text. Remove all terminal escapes so the plain text can be parsed.
 */
export function stripTerminalEscapes(text: string): string {
  return text
    .replace(/\u001b\]8;[^;\u0007\u001b]*;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '') // OSC 8 hyperlinks
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '') // any other OSC
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, ''); // CSI (colours, cursor)
}

/** Hosts a sign-in page may be on. Anything else is not shown as a link, whatever the CLI printed. */
const LOGIN_HOSTS = /(^|\.)(claude\.com|claude\.ai|anthropic\.com)$/;

/**
 * First https URL in the output that points at an Anthropic sign-in host.
 *
 * The CLI prints the URL twice back to back: once as the target of a terminal hyperlink and once
 * as its visible text. Stripping the escapes would glue the two into one broken URL, so the
 * hyperlink targets are read first, and any plain-text URL is split where a new "https://" begins.
 */
export function extractLoginUrl(output: string): string | null {
  const hyperlinkTargets = [...output.matchAll(/\u001b\]8;[^;\u0007\u001b]*;([^\u0007\u001b]+)(?:\u0007|\u001b\\)/g)].map((m) => m[1]);
  const plainText = [...stripTerminalEscapes(output).matchAll(/https:\/\/[^\s"'<>]+/g)].flatMap((m) => m[0].split(/(?=https:\/\/)/));

  for (const candidate of [...hyperlinkTargets, ...plainText]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && LOGIN_HOSTS.test(url.hostname)) return url.href;
    } catch {
      /* not a URL after all */
    }
  }
  return null;
}

/** The CLI asks the user to paste the code shown in the browser after signing in. */
export const waitingForCode = (output: string): boolean => /paste code here/i.test(stripTerminalEscapes(output));

/** Map `claude auth status` JSON to the fields Probe shows. Unknown shapes read as "not signed in". */
export function parseAuthStatus(json: unknown): ClaudeAuth {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    loggedIn: j.loggedIn === true,
    method: str(j.authMethod) ?? 'none',
    plan: str(j.subscriptionType),
    email: str(j.email),
    organization: str(j.orgName),
    configDirectory: str(j.configDirectory),
  };
}

/**
 * Usage windows from a stream-json `rate_limit_event`. The CLI reports `utilization` as 0..1 and
 * `resetsAt` in epoch seconds; Probe keeps milliseconds like everywhere else. Anything else is null.
 */
export function parseRateLimit(ev: unknown): ClaudeUsage | null {
  const windows = (ev as { rate_limit_info?: { unifiedWindows?: Record<string, { utilization?: unknown; resetsAt?: unknown } | undefined> } } | null)?.rate_limit_info?.unifiedWindows;
  if (!windows || typeof windows !== 'object') return null;
  const win = (w: { utilization?: unknown; resetsAt?: unknown } | undefined) => usageWindow(w?.utilization, typeof w?.resetsAt === 'number' ? w.resetsAt * 1000 : null);
  const fiveHour = win(windows.five_hour);
  const sevenDay = win(windows.seven_day);
  return fiveHour || sevenDay ? { fiveHour, sevenDay, at: Date.now() } : null;
}

// ------------------------------------------------------------------ MCP registration

export const MCP_NAME = 'probe';

/**
 * Arguments for `claude mcp add` that register Probe's MCP server for the user's own Claude Code.
 * `runtime` is whatever is running Probe right now: `node` from a source checkout, or the installed
 * app's executable, which only acts as Node when ELECTRON_RUN_AS_NODE is set (so it is passed along).
 */
export function buildMcpAddArgs(o: { runtime: string; script: string; electron: boolean }): string[] {
  // The name must come before -e: -e takes any number of values, so `-e KEY=v probe` would read "probe" as a variable.
  return ['mcp', 'add', '--scope', 'user', MCP_NAME, ...(o.electron ? ['-e', 'ELECTRON_RUN_AS_NODE=1'] : []), '--', o.runtime, o.script];
}

/** The same command as a line a person can paste into a terminal. */
export const formatCommand = (args: string[]): string => ['claude', ...args].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ');

/** Registered means `claude mcp get probe` succeeded; `current` means it points at this install's script. */
export function parseMcpGet(code: number | null, output: string, script: string): { registered: boolean; current: boolean } {
  if (code !== 0) return { registered: false, current: false };
  return { registered: true, current: output.toLowerCase().replaceAll('\\\\', '\\').includes(script.toLowerCase()) };
}
