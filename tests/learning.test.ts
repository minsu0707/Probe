import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortKnowledgeNames } from '../server/modules/learning/knowledge.ts';
import { buildClaudeArgs, buildLearnPrompt } from '../server/modules/learning/prompt.ts';
import { describeTool, parseStreamLine } from '../server/modules/learning/stream.ts';

test('stream: tool use becomes a Korean progress line, text its own event', () => {
  const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'Read', input: { file_path: 'C:\\x\\docs\\spec.md' } }] } });
  assert.deepEqual(parseStreamLine(line), [{ kind: 'text', text: 'hi' }, { kind: 'progress', text: '읽는 중: spec.md' }]);
});

test('stream: result carries success or error', () => {
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'result', is_error: false, result: '요약' })), [{ kind: 'result', ok: true, text: '요약' }]);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'result', is_error: true, result: 'nope' })), [{ kind: 'result', ok: false, text: 'nope' }]);
});

test('stream: junk and blank lines are ignored', () => {
  assert.deepEqual(parseStreamLine(''), []);
  assert.deepEqual(parseStreamLine('Warning: something'), []);
  assert.deepEqual(parseStreamLine(JSON.stringify({ type: 'system' })), []);
});

test('stream: Drive tools are described, unknown tools fall back to their name', () => {
  assert.match(describeTool('mcp__claude_ai_Google_Drive__read_file_content', {}), /Google Drive/);
  assert.equal(describeTool('Mystery', {}), 'Mystery');
});

test('prompt names the service, lists Drive links, and asks for source citations', () => {
  const p = buildLearnPrompt({ serviceName: '쇼핑몰', baseUrl: 'https://shop.test', driveLinks: ['https://drive.google.com/x'], hasExistingKnowledge: false });
  assert.match(p, /"쇼핑몰"/);
  assert.match(p, /https:\/\/drive\.google\.com\/x/);
  assert.match(p, /name its source/);
  assert.ok(!p.includes('earlier version'));
});

test('prompt tells Claude to preserve hand edits when knowledge already exists', () => {
  const p = buildLearnPrompt({ serviceName: 'S', baseUrl: null, driveLinks: [], hasExistingKnowledge: true });
  assert.match(p, /earlier version/);
  assert.match(p, /No Google Drive links/);
});

test('the learning job may not run shell commands or browse the web', () => {
  const args = buildClaudeArgs('p');
  const denied = args.slice(args.indexOf('--disallowedTools') + 1);
  assert.deepEqual(denied, ['Bash', 'WebFetch', 'WebSearch']);
});

test('knowledge files sort in canonical order, extras last', () => {
  assert.deepEqual(sortKnowledgeNames(['rules.md', 'zzz.md', 'overview.md', 'aaa.md', 'flows.md']), ['overview.md', 'flows.md', 'rules.md', 'aaa.md', 'zzz.md']);
});
