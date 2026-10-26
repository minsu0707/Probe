import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownToHtml } from '../web/src/ui/markdown.ts';

test('raw HTML in the source is escaped, never rendered', () => {
  const html = markdownToHtml('<script>alert(1)</script> and <img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;script&gt;/);
});

test('only http(s) links become anchors; javascript: stays text', () => {
  assert.match(markdownToHtml('[ok](https://example.com)'), /<a href="https:\/\/example\.com"/);
  assert.ok(!markdownToHtml('[bad](javascript:alert(1))').includes('<a '));
});

test('a quote in a URL cannot break out of the href attribute', () => {
  const html = markdownToHtml('[x](https://a.com/"onmouseover="alert(1))');
  assert.ok(!/onmouseover="alert/.test(html));
});

test('headings start at h2 because the page owns the h1', () => {
  assert.match(markdownToHtml('# 제목'), /<h2>제목<\/h2>/);
  assert.match(markdownToHtml('### 소제목'), /<h4>소제목<\/h4>/);
});

test('lists, tables and code fences render', () => {
  assert.match(markdownToHtml('- a\n- b'), /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(markdownToHtml('1. a\n2. b'), /<ol>/);
  assert.match(markdownToHtml('| A | B |\n|---|---|\n| 1 | 2 |'), /<th>A<\/th>.*<td>1<\/td>/s);
  assert.match(markdownToHtml('```\n<b>x</b>\n```'), /<pre><code>&lt;b&gt;x&lt;\/b&gt;<\/code><\/pre>/);
});

test('(inferred) markers are highlighted so guesses stand out', () => {
  assert.match(markdownToHtml('로그인 필요 (inferred)'), /<span class="tag-inferred">\(inferred\)<\/span>/);
});
