import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeEnv, extractLoginUrl, parseAuthStatus, stripTerminalEscapes, waitingForCode } from '../server/modules/agents/claude-cli.ts';

const ESC = '\u001b';
const URL_1 = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&state=XyZ-123_q';

/** Shaped like real `claude auth login` output: the URL as a terminal hyperlink, target then text. */
const realisticOutput = `Opening browser to sign in…\nIf the browser didn't open, visit: ${ESC}]8;;${URL_1}${ESC}\\${URL_1}${ESC}]8;;${ESC}\\\nPaste code here if prompted > `;

test('login URL: the hyperlink target is used, not the two URLs glued together', () => {
  assert.equal(extractLoginUrl(realisticOutput), URL_1);
});

test('login URL: a plain-text URL works, and glued duplicates are split', () => {
  assert.equal(extractLoginUrl(`visit: ${URL_1}`), URL_1);
  assert.equal(extractLoginUrl(`${URL_1}${URL_1}`), URL_1);
});

test('login URL: BEL-terminated hyperlinks are handled too', () => {
  assert.equal(extractLoginUrl(`${ESC}]8;;${URL_1}\u0007label${ESC}]8;;\u0007`), URL_1);
});

test('login URL: pages outside Anthropic hosts are never offered as a sign-in link', () => {
  assert.equal(extractLoginUrl('visit https://evil.example/login now'), null);
  assert.equal(extractLoginUrl('visit https://claude.com.evil.example/x'), null);
  assert.equal(extractLoginUrl('visit http://claude.com/insecure'), null);
  assert.equal(extractLoginUrl('no link here'), null);
});

test('the paste-code prompt is recognised, with or without escapes', () => {
  assert.equal(waitingForCode(realisticOutput), true);
  assert.equal(waitingForCode(`${ESC}[1mPaste code here${ESC}[0m`), true);
  assert.equal(waitingForCode('Opening browser to sign in…'), false);
});

test('terminal escapes are removed from text', () => {
  assert.equal(stripTerminalEscapes(`${ESC}[31mred${ESC}[0m and ${ESC}]8;;https://x${ESC}\\link${ESC}]8;;${ESC}\\`), 'red and link');
});

test('auth status: signed-in subscription account', () => {
  const auth = parseAuthStatus({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max', email: 'me@example.com', orgName: 'Acme', configDirectory: 'C:\\cfg', extra: 1 });
  assert.deepEqual(auth, { loggedIn: true, method: 'claude.ai', plan: 'max', email: 'me@example.com', organization: 'Acme', configDirectory: 'C:\\cfg' });
});

test('auth status: signed out, odd or missing JSON all read as not signed in', () => {
  for (const input of [{ loggedIn: false, authMethod: 'none' }, null, 'text', 42, {}, { loggedIn: 'yes' }]) assert.equal(parseAuthStatus(input).loggedIn, false);
  assert.equal(parseAuthStatus({ loggedIn: false }).method, 'none');
});

test('Probe profile: own config folder, Electron flag removed, other variables kept', () => {
  const env = claudeEnv('probe', 'C:\\Probe', { ELECTRON_RUN_AS_NODE: '1', CLAUDE_CONFIG_DIR: 'C:\\somewhere\\else', PATH: 'p' });
  assert.equal(env.CLAUDE_CONFIG_DIR, 'C:\\Probe\\claude');
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.PATH, 'p');
});

test('system profile: the environment decides, so an existing config folder is left alone', () => {
  assert.equal(claudeEnv('system', 'C:\\Probe', { CLAUDE_CONFIG_DIR: 'C:\\existing' }).CLAUDE_CONFIG_DIR, 'C:\\existing');
  assert.equal(claudeEnv('system', 'C:\\Probe', {}).CLAUDE_CONFIG_DIR, undefined);
});

test('usage service figures: percent and ISO reset time become a fraction and epoch ms', async () => {
  const { parseOauthUsage } = await import('../server/modules/agents/live-usage.ts');
  const u = parseOauthUsage({ five_hour: { utilization: 5.5, resets_at: '2026-10-28T06:00:00Z' }, seven_day: { utilization: 34, resets_at: '2026-10-30T00:00:00Z' } }, 7)!;
  assert.equal(u.fiveHour?.utilization, 0.055);
  assert.equal(u.fiveHour?.resetsAt, Date.parse('2026-10-28T06:00:00Z'));
  assert.equal(u.sevenDay?.utilization, 0.34);
  assert.equal(parseOauthUsage({ five_hour: null }), null);
  assert.equal(parseOauthUsage('nope'), null);
});
