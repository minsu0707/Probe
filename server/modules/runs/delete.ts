/**
 * Deleting test cases. A spec file whose cases are all deleted goes to the computer's Recycle Bin
 * as it is. When only some cases of a file are deleted, their `test(...)` blocks (and the comment
 * lines above) are cut out of it, and the file as it was before is put in the Recycle Bin too, so
 * nothing is gone for good. Only files under tests/specs/ are touched.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { testsDir } from '../../config.ts';
import { unprocessable } from '../../core/errors.ts';
import { moveToRecycleBin } from '../../core/recycle.ts';
import { requireService } from '../services/service.ts';
import { listTestCases } from './cases.ts';

const TEST_START = /^\s*test(\.\w+)?\s*\(/;

/** A spec path relative to specs/: letters of any language (spec files are named after features, often in Korean), digits and _ @ . / -. No leading dash (an option), no `..`. */
export const isSafeSpecName = (file: string): boolean => /^[\p{L}\p{N}_@.\/-]+$/u.test(file) && !file.startsWith('-') && !file.includes('..');

const specPath = (serviceId: string, file: string) => {
  if (!isSafeSpecName(file)) throw unprocessable('Bad file name');
  return join(testsDir(serviceId), 'specs', file);
};

/** Index just past the statement that starts at `from` (a `test(` call): matching brackets, skipping strings and comments. */
export function endOfCall(src: string, from: number): number {
  let depth = 0;
  let started = false;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') i = src.indexOf('\n', i) === -1 ? src.length : src.indexOf('\n', i);
    else if (ch === '/' && next === '*') i = src.indexOf('*/', i + 2) === -1 ? src.length : src.indexOf('*/', i + 2) + 1;
    else if (ch === "'" || ch === '"' || ch === '`') i = skipString(src, i);
    else if (ch === '(' || ch === '[' || ch === '{') (depth++, (started = true));
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (started && depth === 0) return src[i + 1] === ';' ? i + 2 : i + 1;
    }
  }
  return -1;
}

function skipString(src: string, start: number): number {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === quote) return i;
    else if (quote === '`' && src[i] === '$' && src[i + 1] === '{') i = skipTemplateExpr(src, i + 1);
  }
  return src.length;
}

function skipTemplateExpr(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i;
    else if (src[i] === "'" || src[i] === '"' || src[i] === '`') i = skipString(src, i);
  }
  return src.length;
}

/** Cuts the test that starts on 1-based `line` out of `text`. Returns the rest, or null if no test starts there. */
export function cutTest(text: string, line: number): { rest: string; removed: string } | null {
  const lines = text.split('\n');
  if (!TEST_START.test(lines[line - 1] ?? '')) return null;
  let first = line - 1;
  while (first > 0 && /^\s*\/\//.test(lines[first - 1])) first--; // the source comment belongs to the test
  const offsetOf = (n: number) => lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
  const end = endOfCall(text, offsetOf(line - 1));
  if (end < 0) return null;
  const startIdx = offsetOf(first);
  let stop = text.indexOf('\n', end);
  stop = stop === -1 ? text.length : stop + 1;
  const removed = text.slice(startIdx, stop).replace(/\r?\n$/, '');
  const rest = (text.slice(0, startIdx) + text.slice(stop)).replace(/\n{3,}/g, '\n\n'); // no gap where the test was
  return { rest, removed };
}

/** A copy of `path` under a temp folder, named so it is recognisable in the Recycle Bin, then sent there. */
function recycleCopy(path: string, label: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'probe-del-'));
  const copy = join(dir, `${label} ${basename(path)}`);
  copyFileSync(path, copy);
  moveToRecycleBin(copy);
}

/** Deletes the given cases; returns how many were removed. Fails without changing anything if the Recycle Bin is unavailable. */
export async function deleteTests(serviceId: string, tests: { file: string; line: number }[]): Promise<number> {
  requireService(serviceId);
  const { cases } = await listTestCases(serviceId);
  const byFile = new Map<string, number[]>();
  for (const t of tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t.line]);

  let removed = 0;
  for (const [file, lines] of byFile) {
    const path = specPath(serviceId, file);
    if (!existsSync(path)) continue;
    const inFile = cases.filter((c) => c.file === file).map((c) => c.line);
    if (inFile.length > 0 && inFile.every((l) => lines.includes(l))) {
      moveToRecycleBin(path);
      removed += inFile.length;
      continue;
    }
    const original = readFileSync(path, 'utf8');
    const crlf = original.includes('\r\n');
    let text = original.replace(/\r\n/g, '\n');
    let cut = 0;
    // bottom-up, so earlier line numbers stay valid
    for (const line of [...new Set(lines)].sort((a, b) => b - a)) {
      const r = cutTest(text, line);
      if (r) (text = r.rest, cut++);
    }
    if (!cut) continue;
    recycleCopy(path, '삭제 전');
    writeFileSync(path, crlf ? text.replace(/\n/g, '\r\n') : text);
    removed += cut;
  }
  return removed;
}

/** For Claude's "delete": put the file's earlier content back, then send it to the Recycle Bin, so it is recoverable from there. */
export function recycleSpec(path: string, earlier: string | undefined): void {
  if (earlier !== undefined && earlier.trim() && earlier.trim() !== '// probe:delete') {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, earlier);
  }
  moveToRecycleBin(path);
}
