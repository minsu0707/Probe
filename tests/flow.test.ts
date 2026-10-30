import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeAct, encodeAct, isSecretTarget, readableTarget, shorten, type Act } from '../shared/actions.ts';
import { flowOfRun } from '../shared/flow.ts';
import type { LogKind, LogLine } from '../shared/models.ts';

let id = 0;
const line = (kind: LogKind, text: string): LogLine => ({ id: ++id, ts: id, kind, text });
const act = (a: Act): LogLine => line('action', encodeAct(a));

test('a locator is named the way a person would say it', () => {
  assert.equal(readableTarget("getByLabel('제품명')"), '제품명');
  assert.equal(readableTarget("getByRole('button', { name: '저장' })"), '저장');
  assert.equal(readableTarget("getByPlaceholder('이름')"), '이름');
  assert.equal(readableTarget("locator('#p')"), '#p');
});

test('a chain of locators is said in words, not shown as code', () => {
  assert.equal(readableTarget("locator('table').filter({ hasText: '경과일' }).last().locator('tbody tr').nth(2).locator('input').first()"), '마지막 ‘경과일’ 표 › 3번째 행 › 첫 번째 입력칸');
  assert.equal(readableTarget("getByRole('dialog').getByRole('button', { name: '확인' })"), '대화상자 › 확인');
  assert.equal(readableTarget("locator('#mat-list').locator('tbody tr').filter({ hasText: '감귤착즙액' }).first()"), '#mat-list › 첫 번째 ‘감귤착즙액’ 행');
  assert.equal(readableTarget("locator('weird::thing')"), 'weird::thing');
});

test('an action survives the trip through the log, and long values are cut', () => {
  const a: Act = { what: 'fill', target: '제품명', value: '누드빼빼로' };
  assert.deepEqual(decodeAct(encodeAct(a)), a);
  assert.equal(decodeAct('not json'), null);
  assert.ok(shorten('가'.repeat(500)).length <= 121);
  assert.ok(isSecretTarget('비밀번호'));
  assert.ok(!isSecretTarget('제품명'));
});

test('the chain shows screens and actions of the latest test only, and nothing else', () => {
  const nodes = flowOfRun([
    line('test', 'A › 앞 테스트'),
    act({ what: 'click', target: '지난 버튼' }),
    line('test', 'A › 지금 테스트'),
    line('step', 'GET'),
    line('page', '/#product'),
    line('view', 'M1 제품 › 제품 등록'),
    act({ what: 'fill', target: '제품명', value: '누드빼빼로' }),
    line('step', 'Expect "toBe"'),
    act({ what: 'click', target: '저장' }),
  ]);
  assert.equal(nodes.title, '지금 테스트');
  assert.deepEqual(
    nodes.nodes.map((n) => [n.kind, n.label, n.detail]),
    [
      ['stage', '제품 등록', '/#product'],
      ['act', '제품명', '누드빼빼로'],
      ['act', '저장', undefined],
    ],
  );
});

test('a page line after the screen name, or before it, still makes one stage', () => {
  const viewFirst = flowOfRun([line('test', 't'), line('view', '홈'), line('page', '/#home'), act({ what: 'click', target: '확인' })]).nodes;
  const pageFirst = flowOfRun([line('test', 't'), line('page', '/#home'), line('view', '홈'), act({ what: 'click', target: '확인' })]).nodes;
  for (const nodes of [viewFirst, pageFirst]) assert.deepEqual(nodes.slice(0, 1).map((n) => [n.label, n.detail]), [['홈', '/#home']]);
  assert.equal(viewFirst.length, 2);
});

test('the same action again and again is one node with a count; a new page starts a new stage', () => {
  const { nodes } = flowOfRun([
    line('test', 't'),
    act({ what: 'request', target: 'POST /api/materials', value: '{"name":"a"}' }),
    act({ what: 'request', target: 'POST /api/materials', value: '{"name":"a"}' }),
    act({ what: 'request', target: 'POST /api/materials', value: '{"name":"b"}' }),
    line('page', '/#material'),
  ]);
  assert.deepEqual(nodes.map((n) => [n.kind, n.count]), [['act', 2], ['act', 1], ['stage', 1]]);
});
