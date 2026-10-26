/**
 * The Claude Code CLI as an "agent": is it installed, who is it signed in as, and signing in
 * from inside Probe.
 *
 * Probe never handles Anthropic credentials. Every operation here runs the official `claude`
 * CLI and reads its output; the sign-in itself happens in the user's browser, and the CLI stores
 * the result in its own config folder (see claude-cli.ts for which folder).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { HOME, ensureDir } from '../../config.ts';
import { badRequest, conflict, unprocessable } from '../../core/errors.ts';
import { broadcast } from '../../core/hub.ts';
import { killTree } from '../../core/process.ts';
import type { ClaudeAgentStatus, ClaudeAuth, ClaudeProfile, LoginState } from '../../../shared/models.ts';
import { BACKGROUND_ALLOWED_TOOLS, BACKGROUND_DENIED_TOOLS, claudeEnv, extractLoginUrl, parseAuthStatus, stripTerminalEscapes, waitingForCode } from './claude-cli.ts';
import { getProfile, setProfile } from './settings.ts';
import { getUsage } from './usage.ts';

const QUICK_COMMAND_TIMEOUT_MS = 15_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_CHARS = 20_000;
/** How long to wait for the CLI to react to a pasted code before telling the user. */
const CODE_REPLY_TIMEOUT_MS = 15_000;
const CHECKING_MESSAGE = '코드를 확인하는 중…';

/** Environment for any `claude` child under the currently selected profile. */
export function currentClaudeEnv(profile: ClaudeProfile = getProfile()): NodeJS.ProcessEnv {
  if (profile === 'probe') ensureDir(`${HOME}/claude`);
  return claudeEnv(profile, HOME);
}

// --------------------------------------------------------------- quick commands

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
  /** The program does not exist (CLI not installed). */
  missing: boolean;
}

/** Run `claude <args>` to completion with a deadline. Never throws. */
function runClaude(args: string[], env: NodeJS.ProcessEnv): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn('claude', args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => killTree(child), QUICK_COMMAND_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => (stdout += d));
    child.stderr.on('data', (d: Buffer) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, missing: (e as NodeJS.ErrnoException).code === 'ENOENT' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, missing: false });
    });
  });
}

export async function detectClaude(): Promise<{ installed: boolean; version: string | null }> {
  const r = await runClaude(['--version'], currentClaudeEnv());
  if (r.missing || r.code !== 0) return { installed: false, version: null };
  return { installed: true, version: r.stdout.trim().split(/\s+/)[0] || null };
}

/** Sign-in state for a profile. A failure to run or parse means "not signed in", not an error. */
export async function authStatus(profile: ClaudeProfile): Promise<ClaudeAuth> {
  const r = await runClaude(['auth', 'status', '--json'], currentClaudeEnv(profile));
  try {
    return parseAuthStatus(JSON.parse(r.stdout));
  } catch {
    return parseAuthStatus(null);
  }
}

/** Gate for jobs that need Claude: a clear message instead of a failed process. */
export async function requireClaudeReady(): Promise<NodeJS.ProcessEnv> {
  const { installed } = await detectClaude();
  if (!installed) throw unprocessable('Claude Code is not installed. Install it, then sign in under Settings → Agents.');
  if (!(await authStatus(getProfile())).loggedIn) throw unprocessable('Claude is not signed in. Sign in under Settings → Agents, then try again.');
  return currentClaudeEnv();
}

export async function claudeStatus(): Promise<ClaudeAgentStatus> {
  const profile = getProfile();
  const { installed, version } = await detectClaude();
  const auth = installed ? await authStatus(profile) : null;
  // Offer the user's existing login when Probe's own profile is empty.
  const systemAuth = installed && profile === 'probe' && !auth?.loggedIn ? await authStatus('system') : null;
  return { installed, version, profile, auth, systemAuth: systemAuth?.loggedIn ? systemAuth : null, login: loginState(), allowedTools: BACKGROUND_ALLOWED_TOOLS, deniedTools: BACKGROUND_DENIED_TOOLS, usage: getUsage() };
}

export function selectProfile(profile: ClaudeProfile): void {
  if (profile !== 'probe' && profile !== 'system') throw badRequest('Unknown profile');
  if (login.child) throw conflict('Finish or cancel the sign-in first');
  setProfile(profile);
  broadcast({ type: 'agent' });
}

export async function logout(): Promise<void> {
  const r = await runClaude(['auth', 'logout'], currentClaudeEnv());
  if (r.code !== 0) throw unprocessable(stripTerminalEscapes(r.stderr || r.stdout).trim() || 'Sign-out failed');
  broadcast({ type: 'agent' });
}

// -------------------------------------------------------------------- sign-in

/**
 * One sign-in at a time. `claude auth login` opens the browser and prints the sign-in URL, then
 * waits for the code the sign-in page shows ("Paste code here"). Probe relays that: it shows the
 * URL, accepts the pasted code and writes it to the process's stdin. The code is never stored or logged.
 */
interface Login {
  state: LoginState;
  child: ChildProcess | null;
  /** Everything the CLI printed, capped, for finding the URL and the prompt. */
  output: string;
  cancelled: boolean;
  /** Length of `output` when the code was sent, so only the CLI's reply to it is shown. */
  outputAtSubmit: number | null;
}

/** Last non-empty line of CLI output, with terminal escapes removed. */
const lastLine = (text: string): string =>
  stripTerminalEscapes(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-1)[0] ?? '';

const idle: LoginState = { phase: 'idle', url: null, needsCode: false, message: null };
const login: Login = { state: idle, child: null, output: '', cancelled: false, outputAtSubmit: null };

export const loginState = (): LoginState => login.state;

function setLogin(patch: Partial<LoginState>): void {
  login.state = { ...login.state, ...patch };
  broadcast({ type: 'agent' });
}

export function startLogin(opts: { method?: 'claudeai' | 'console'; email?: string } = {}): LoginState {
  if (login.child) throw conflict('A sign-in is already in progress');
  if (opts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opts.email)) throw badRequest('That does not look like an email address');

  const args = ['auth', 'login', opts.method === 'console' ? '--console' : '--claudeai', ...(opts.email ? ['--email', opts.email] : [])];
  const child = spawn('claude', args, { env: currentClaudeEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  login.child = child;
  login.output = '';
  login.cancelled = false;
  login.outputAtSubmit = null;
  login.state = { phase: 'starting', url: null, needsCode: false, message: '로그인을 시작하는 중…' };
  broadcast({ type: 'agent' });

  const onOutput = (chunk: Buffer) => {
    login.output = (login.output + chunk.toString('utf8')).slice(-MAX_OUTPUT_CHARS);
    if (login.outputAtSubmit !== null && login.output.length > login.outputAtSubmit) {
      // The CLI answered the code (e.g. "invalid code"). Show its words; the code box stays open for another try.
      const reply = lastLine(login.output.slice(login.outputAtSubmit));
      if (reply && !/paste code here/i.test(reply)) return setLogin({ message: `Claude: ${reply.slice(0, 200)}` });
    }
    const url = extractLoginUrl(login.output);
    const needsCode = waitingForCode(login.output);
    if (url !== login.state.url || needsCode !== login.state.needsCode) {
      setLogin({ phase: 'waiting', url, needsCode, message: url ? '브라우저에서 로그인한 뒤, 화면에 나온 코드를 아래에 붙여넣으세요.' : '로그인 주소를 기다리는 중…' });
    }
  };
  child.stdout!.on('data', onOutput);
  child.stderr!.on('data', onOutput);
  child.stdin!.on('error', () => undefined); // writing after the process ended is not an error worth surfacing

  const timer = setTimeout(() => {
    setLogin({ message: '시간이 지나 로그인을 취소했습니다. 다시 시도하세요.' });
    killTree(child);
  }, LOGIN_TIMEOUT_MS);

  child.on('error', (e) => {
    clearTimeout(timer);
    login.child = null;
    setLogin({ phase: 'failed', needsCode: false, message: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'Claude Code가 설치되어 있지 않습니다.' : `로그인을 시작하지 못했습니다: ${e.message}` });
  });

  child.on('close', async (code) => {
    clearTimeout(timer);
    login.child = null;
    if (login.cancelled) return setLogin({ phase: 'cancelled', needsCode: false, message: '로그인을 취소했습니다.' });
    setLogin({ phase: 'verifying', needsCode: false, message: '로그인 결과를 확인하는 중…' });
    const auth = await authStatus(getProfile());
    if (auth.loggedIn) return setLogin({ phase: 'done', message: '로그인되었습니다.' });
    const detail = stripTerminalEscapes(login.output).split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0];
    setLogin({ phase: 'failed', message: `로그인이 완료되지 않았습니다${code ? ` (코드 ${code})` : ''}.${detail ? ` ${detail}` : ''}` });
  });

  return login.state;
}

export function submitLoginCode(code: string): void {
  const trimmed = code.trim();
  if (!login.child || !login.state.needsCode) throw conflict('The sign-in is not waiting for a code');
  if (!trimmed || trimmed.length > 500 || /[\r\n]/.test(trimmed)) throw badRequest('Paste the code exactly as shown in the browser');
  login.outputAtSubmit = login.output.length;
  login.child.stdin!.write(`${trimmed}\n`);
  setLogin({ message: CHECKING_MESSAGE });
  setTimeout(() => {
    if (login.child && login.state.message === CHECKING_MESSAGE) setLogin({ message: '응답이 없습니다. 코드를 다시 확인해서 붙여넣거나, 취소하고 다시 시도하세요.' });
  }, CODE_REPLY_TIMEOUT_MS).unref();
}

export function cancelLogin(): void {
  if (!login.child) throw conflict('No sign-in is in progress');
  login.cancelled = true;
  killTree(login.child);
}
