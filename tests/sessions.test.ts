import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMcpAddArgs, formatCommand, parseMcpGet, parseRateLimit } from '../server/modules/agents/claude-cli.ts';
import { parseStreamLine } from '../server/modules/learning/stream.ts';
import { buildSystemPrompt, openingMessage } from '../server/modules/sessions/prompt.ts';
import { buildArgs } from '../server/modules/sessions/service.ts';

const line = (o: unknown) => JSON.stringify(o);

test('the first turn creates the CLI session, later turns resume it', () => {
  const base = { prompt: 'hi', claudeSessionId: 'abc', system: 'sys' };
  const first = buildArgs({ ...base, resume: false });
  const next = buildArgs({ ...base, resume: true });
  assert.equal(first[first.indexOf('--session-id') + 1], 'abc');
  assert.ok(!first.includes('--resume'));
  assert.equal(next[next.indexOf('--resume') + 1], 'abc');
  assert.ok(!next.includes('--session-id'));
});

test('background sessions never get a shell or the web, and are not one-shot', () => {
  const args = buildArgs({ prompt: 'x', claudeSessionId: 'abc', resume: false, system: 's' });
  const denied = args.slice(args.indexOf('--disallowedTools') + 1);
  for (const tool of ['Bash', 'WebFetch', 'WebSearch']) assert.ok(denied.includes(tool));
  assert.ok(!args.includes('--no-session-persistence'));
  assert.ok(!args.includes('--dangerously-skip-permissions'));
});

test('stream: assistant text and tool use keep their order', () => {
  const ev = parseStreamLine(line({ type: 'assistant', message: { content: [{ type: 'text', text: '읽겠습니다' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a/b/flows.md' } }, { type: 'text', text: '  ' }] } }));
  assert.deepEqual(ev, [
    { kind: 'text', text: '읽겠습니다' },
    { kind: 'progress', text: '읽는 중: flows.md' },
  ]);
});

test('stream: init, result and unknown lines', () => {
  assert.deepEqual(parseStreamLine(line({ type: 'system', subtype: 'init', session_id: 'x' })), [{ kind: 'init' }]);
  assert.deepEqual(parseStreamLine(line({ type: 'system', subtype: 'hook_started' })), []);
  assert.deepEqual(parseStreamLine(line({ type: 'result', is_error: false, result: 'done' })), [{ kind: 'result', ok: true, text: 'done' }]);
  assert.deepEqual(parseStreamLine('not json'), []);
});

test('usage: windows are read from rate_limit_event, seconds become milliseconds', () => {
  const ev = { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.03, resetsAt: 1000 }, seven_day: { utilization: 1.4, resetsAt: 2000 } } } };
  const usage = parseRateLimit(ev)!;
  assert.deepEqual(usage.fiveHour, { utilization: 0.03, resetsAt: 1_000_000 });
  assert.equal(usage.sevenDay?.utilization, 1); // clamped
  assert.equal(parseRateLimit({ type: 'rate_limit_event' }), null);
  assert.equal(parseRateLimit(null), null);
});

test('the system prompt gives env names, never values, and the knowledge list', () => {
  const p = buildSystemPrompt({ serviceName: 'Shop', baseUrl: 'https://s.example', envNames: ['ADMIN_ID', 'ADMIN_PW'], knowledgeFiles: ['flows.md'] });
  assert.match(p, /ADMIN_ID, ADMIN_PW/);
  assert.match(p, /flows\.md/);
  assert.match(p, /cannot run commands/);
  assert.match(buildSystemPrompt({ serviceName: 'Shop', baseUrl: null, envNames: [], knowledgeFiles: [] }), /nothing yet/);
});

test('opening message: the button narrows with a focus, a chat is just the text', () => {
  assert.match(openingMessage('write-tests', ''), /P0 test points first/);
  assert.match(openingMessage('write-tests', '로그인'), /Focus on: 로그인/);
  assert.equal(openingMessage('chat', ''), '');
  assert.equal(openingMessage('chat', '안녕'), '안녕');
});
// Windows paths are built from a backslash constant so the test source needs no escape sequences.
const BS = String.fromCharCode(92);
const winPath = (...parts: string[]) => parts.join(BS);

test('mcp: source runs register plain node, the installed app adds ELECTRON_RUN_AS_NODE', () => {
  const script = winPath('C:', 'p', 'mcp', 'server.ts');
  assert.deepEqual(buildMcpAddArgs({ runtime: 'node', script, electron: false }), ['mcp', 'add', '--scope', 'user', 'probe', '--', 'node', script]);
  const app = buildMcpAddArgs({ runtime: winPath('C:', 'Probe', 'Probe.exe'), script, electron: true });
  // The name precedes -e (a variadic option that would otherwise swallow it); everything after -- is the server command.
  assert.deepEqual(app.slice(3, 7), ['user', 'probe', '-e', 'ELECTRON_RUN_AS_NODE=1']);
  assert.equal(app[7], '--');
  assert.equal(app[8], winPath('C:', 'Probe', 'Probe.exe'));
});

test('mcp: the pasteable command quotes paths with spaces', () => {
  const p = winPath('C:', 'Program Files', 'x', 'server.ts');
  assert.equal(formatCommand(['mcp', 'add', '--', 'node', p]), `claude mcp add -- node "${p}"`);
});

test('mcp: registered / current are read from `claude mcp get`', () => {
  const script = winPath('C:', 'Users', 'me', 'Probe', 'mcp', 'server.ts');
  assert.deepEqual(parseMcpGet(1, 'No MCP server named "probe"', script), { registered: false, current: false });
  assert.deepEqual(parseMcpGet(0, `probe:\n  Args: ${script}`, script), { registered: true, current: true });
  assert.deepEqual(parseMcpGet(0, `probe:\n  Args: ${script.replaceAll(BS, BS + BS)}`, script), { registered: true, current: true }); // JSON-style doubled backslashes
  assert.deepEqual(parseMcpGet(0, `probe:\n  Args: ${winPath('D:', 'old', 'mcp', 'server.ts')}`, script), { registered: true, current: false });
});
