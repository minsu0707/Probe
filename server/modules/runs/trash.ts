/**
 * Deleting a test case cuts its `test(...)` block (and the comment lines above it) out of the spec
 * file and keeps the text in the service's trash folder, so it can be put back. Only files under
 * tests/specs/ are touched, and only at lines that start a `test(` call.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serviceDir, testsDir } from '../../config.ts';
import { newId } from '../../core/ids.ts';
import { notFound, unprocessable } from '../../core/errors.ts';
import type { TrashedCase } from '../../../shared/models.ts';
import { requireService } from '../services/service.ts';

const TEST_START = /^\s*test(\.\w+)?\s*\(/;
const FILE_HEADER = "import { test, expect, view } from '../probe.ts';\n\n";

const trashDir = (serviceId: string) => join(serviceDir(serviceId), 'trash');
const specPath = (serviceId: string, file: string) => {
  if (!/^[\w@.\/-]+$/.test(file) || file.startsWith('-') || file.includes('..')) throw unprocessable('Bad file name');
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

/** Cuts the test that starts on 1-based `line` out of `text`. Returns the rest and the removed block, or null if no test starts there. */
export function cutTest(text: string, line: number): { rest: string; removed: string } | null {
  const lines = text.split('\n');
  if (!TEST_START.test(lines[line - 1] ?? '')) return null;
  let first = line - 1;
  while (first > 0 && /^\s*\/\//.test(lines[first - 1])) first--; // the source comment belongs to the test
  const offset = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  const end = endOfCall(text, offset);
  if (end < 0) return null;
  const startIdx = lines.slice(0, first).reduce((n, l) => n + l.length + 1, 0);
  let stop = text.indexOf('\n', end);
  stop = stop === -1 ? text.length : stop + 1;
  const removed = text.slice(startIdx, stop).replace(/\r?\n$/, '');
  let rest = text.slice(0, startIdx) + text.slice(stop);
  rest = rest.replace(/\n{3,}/g, '\n\n'); // do not leave a gap where the test was
  return { rest, removed };
}

/** Moves the given tests to the trash. Returns how many were removed. */
export function trashTests(serviceId: string, tests: { file: string; line: number; title?: string; feature?: string }[]): TrashedCase[] {
  requireService(serviceId);
  const byFile = new Map<string, typeof tests>();
  for (const t of tests) byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);

  const done: TrashedCase[] = [];
  for (const [file, list] of byFile) {
    const path = specPath(serviceId, file);
    if (!existsSync(path)) continue;
    let text = readFileSync(path, 'utf8');
    const crlf = text.includes('\r\n');
    text = text.replace(/\r\n/g, '\n');
    // Bottom-up, so earlier line numbers stay valid while cutting.
    for (const t of [...list].sort((a, b) => b.line - a.line)) {
      const cut = cutTest(text, t.line);
      if (!cut) continue;
      text = cut.rest;
      const item: TrashedCase = { id: newId(), file, title: t.title ?? cut.removed.match(/\(\s*(['"`])(.*?)\1/s)?.[2] ?? '(제목 없음)', feature: t.feature ?? '', text: cut.removed, deletedAt: Date.now() };
      mkdirSync(trashDir(serviceId), { recursive: true });
      writeFileSync(join(trashDir(serviceId), `${item.id}.json`), JSON.stringify(item));
      done.push(item);
    }
    if (done.some((d) => d.file === file)) writeFileSync(path, crlf ? text.replace(/\n/g, '\r\n') : text);
  }
  return done;
}

/** A whole spec file that Claude emptied or marked for deletion: keep what it held. */
export function trashFileContent(serviceId: string, file: string, text: string): void {
  if (!text.trim() || text.trim() === '// probe:delete') return;
  const item: TrashedCase = { id: newId(), file, title: file, feature: '', text, whole: true, deletedAt: Date.now() };
  mkdirSync(trashDir(serviceId), { recursive: true });
  writeFileSync(join(trashDir(serviceId), `${item.id}.json`), JSON.stringify(item));
}

export function listTrash(serviceId: string): TrashedCase[] {
  requireService(serviceId);
  let names: string[];
  try {
    names = readdirSync(trashDir(serviceId)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const items: TrashedCase[] = [];
  for (const n of names) {
    try {
      items.push(JSON.parse(readFileSync(join(trashDir(serviceId), n), 'utf8')));
    } catch {
      /* unreadable entry: skip */
    }
  }
  return items.sort((a, b) => b.deletedAt - a.deletedAt);
}

const trashFile = (serviceId: string, id: string) => {
  if (!/^[\w-]+$/.test(id)) throw notFound('Not in the trash');
  return join(trashDir(serviceId), `${id}.json`);
};

/** Appends the case back to its original spec file (recreating the file if it is gone). */
export function restoreTrashed(serviceId: string, id: string): TrashedCase {
  requireService(serviceId);
  const path = trashFile(serviceId, id);
  if (!existsSync(path)) throw notFound('Not in the trash');
  const item = JSON.parse(readFileSync(path, 'utf8')) as TrashedCase;
  const target = specPath(serviceId, item.file);
  mkdirSync(dirname(target), { recursive: true });
  if (item.whole && !existsSync(target)) {
    writeFileSync(target, item.text);
    rmSync(path, { force: true });
    return item;
  }
  const current = existsSync(target) ? readFileSync(target, 'utf8') : FILE_HEADER.trimEnd() + '\n';
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(target, `${current.replace(/\s*$/, '')}${eol}${eol}${item.text.replace(/\n/g, eol)}${eol}`);
  rmSync(path, { force: true });
  return item;
}

/** Forgets one trashed case for good, or everything when `id` is omitted. */
export function emptyTrash(serviceId: string, id?: string): void {
  requireService(serviceId);
  if (id) rmSync(trashFile(serviceId, id), { force: true });
  else rmSync(trashDir(serviceId), { recursive: true, force: true });
}
