import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowOperateRequest, fillValue, isSaveLabel, isSearchField, newLines, recordToMarkdown } from '../server/modules/learning/operate-helpers.ts';

test('only saving requests leave the browser: reads pass, deleting never does', () => {
  assert.equal(allowOperateRequest('GET', 'https://x.test/api/items'), true);
  assert.equal(allowOperateRequest('POST', 'https://x.test/api/items'), true);
  assert.equal(allowOperateRequest('PUT', 'https://x.test/api/items/1'), true);
  assert.equal(allowOperateRequest('PATCH', 'https://x.test/api/items/1'), true);
  assert.equal(allowOperateRequest('DELETE', 'https://x.test/api/items/1'), false);
  assert.equal(allowOperateRequest('POST', 'https://x.test/api/items/delete'), false);
  assert.equal(allowOperateRequest('POST', 'https://x.test/auth/logout'), false);
});

test('buttons that save are pressed; buttons that approve, send, pay, cancel or delete are not', () => {
  for (const ok of ['저장', '등록', '원료 등록', '추가', 'Save', 'Create item']) assert.equal(isSaveLabel(ok), true, ok);
  for (const no of ['승인', '확정', '검토 요청', '발송', '결제', '취소', '저장 후 승인', '삭제', 'Approve', 'Send', '로그아웃', '확인', '조회']) assert.equal(isSaveLabel(no), false, no);
});

test('values are chosen from the label and the type; search boxes are not part of a form', () => {
  assert.equal(fillValue('원료명', 'text', '2026-10-29'), 'QA-AUTO-탐색');
  assert.equal(fillValue('수량', 'text', '2026-10-29'), '1');
  assert.equal(fillValue('', 'number', '2026-10-29'), '1');
  assert.equal(fillValue('등록일', 'date', '2026-10-29'), '2026-10-29');
  assert.equal(fillValue('담당자 이메일', 'text', '2026-10-29'), 'qa-auto@example.com');
  assert.equal(fillValue('연락처', 'tel', '2026-10-29'), '010-0000-0000');
  assert.equal(isSearchField('제품 검색', 'text'), true);
  assert.equal(isSearchField('', 'search'), true);
  assert.equal(isSearchField('원료명', 'text'), false);
});

test('what appeared after saving is the new lines only, shortened', () => {
  assert.deepEqual(newLines('목록\n원료 A', '목록\n원료 A\n등록되었습니다\n원료 B'), ['등록되었습니다', '원료 B']);
  assert.equal(newLines('', 'x'.repeat(200))[0].length, 81);
  assert.equal(newLines('a', 'a').length, 0);
});

test('the notes say what was filled, what each save answered and what changed', () => {
  const md = recordToMarkdown({ n: 2, title: '원료 등록', url: 'https://x.test/new', filled: ['원료명 = QA-AUTO-탐색'], button: '저장', emptyMessages: ['원료명을 입력하세요'], messages: ['등록되었습니다'], urlAfter: 'https://x.test/items/1', appeared: ['PRD-0001'], shot: 'shots/009.jpg' });
  for (const part of ['## 조작 2. 원료 등록', '원료명 = QA-AUTO-탐색', '누른 버튼: 저장', '비워 둔 채 저장: 원료명을 입력하세요', '채워서 저장 후 안내: 등록되었습니다', '저장 후 주소: https://x.test/items/1', 'PRD-0001', 'shots/009.jpg']) assert.ok(md.includes(part), part);
  assert.match(recordToMarkdown({ n: 1, title: 't', url: 'u', filled: [], button: '저장', emptyMessages: [], messages: [], urlAfter: null, appeared: [], shot: null }), /화면에 나온 안내 없음/);
});
