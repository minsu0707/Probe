import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainTitle, splitSections } from '../web/src/features/learn/sections.ts';

test('a lone title stays in the intro and the repeated level becomes sections', () => {
  const doc = splitSections('# 업무 흐름\n\n설명\n\n## F-00 전체\n\n내용 0\n\n## F-01 로그인\n\n내용 1\n\n### 세부\n\n하위\n\n## F-02 등록\n\n내용 2');
  assert.ok(doc);
  assert.equal(doc.intro, '# 업무 흐름\n\n설명');
  assert.deepEqual(doc.sections.map((s) => s.title), ['F-00 전체', 'F-01 로그인', 'F-02 등록']);
  assert.ok(doc.sections[1].body.includes('### 세부'));
  assert.ok(!doc.sections[1].body.includes('내용 2'));
});

test('headings inside code fences are not sections', () => {
  const doc = splitSections('## A\n\n```\n## not\n## not\n```\n\n## B\n\nx\n\n## C\n\ny');
  assert.deepEqual(doc?.sections.map((s) => s.title), ['A', 'B', 'C']);
});

test('short documents are not folded', () => {
  assert.equal(splitSections('# T\n\n## A\n\nx\n\n## B\n\ny'), null);
  assert.equal(splitSections('just text'), null);
});

test('plainTitle drops Markdown decoration', () => {
  assert.equal(plainTitle('**F-01** `x` [링크](http://a) 끝'), 'F-01 x 링크 끝');
});
