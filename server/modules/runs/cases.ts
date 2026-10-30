/**
 * The test cases Claude wrote, as a flat list for the dashboard: asks Playwright itself to list
 * what it would run (`test --list`), so the answer is the same as what a run executes. Nothing is
 * executed and no credentials are passed.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { testsDir } from '../../config.ts';
import type { TestCase } from '../../../shared/models.ts';
import { requireService } from '../services/service.ts';
import { scaffoldWorkspace } from '../services/workspace.ts';

const require = createRequire(import.meta.url);
const LIST_TIMEOUT_MS = 30_000;
const ANSI = /\u001b\[[0-9;]*m/g;

interface JsonSpec {
  title: string;
  file: string;
  line: number;
  tags?: string[];
}
interface JsonSuite {
  title: string;
  file?: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

/** Flattens Playwright's nested suites (file → describe → describe → test) into cases. */
export function flattenSuites(suites: JsonSuite[], readSource: (file: string) => string[] = () => []): TestCase[] {
  const out: TestCase[] = [];
  const walk = (suite: JsonSuite, path: string[], isFile: boolean) => {
    // The top level of each suite is the file itself; only describe blocks name a feature.
    const here = isFile ? path : [...path, suite.title];
    for (const spec of suite.specs ?? []) out.push(toCase(spec, here, readSource));
    for (const child of suite.suites ?? []) walk(child, here, false);
  };
  for (const s of suites) walk(s, [], true);
  return out;
}

function toCase(spec: JsonSpec, describePath: string[], readSource: (file: string) => string[]): TestCase {
  return {
    id: `${spec.file}:${spec.line}`,
    file: spec.file,
    line: spec.line,
    title: spec.title,
    feature: describePath.join(' › ') || '(그룹 없음)',
    tags: spec.tags ?? [],
    source: sourceComment(readSource(spec.file), spec.line),
    steps: stepTitles(readSource(spec.file), spec.line),
  };
}

/** The `//` comment lines directly above the test(...) line: where Claude cites the document the expectation came from. */
export function sourceComment(lines: string[], line: number): string | null {
  const found: string[] = [];
  for (let i = line - 2; i >= 0 && /^\s*\/\//.test(lines[i] ?? ''); i--) found.unshift(lines[i].replace(/^\s*\/\/\s?/, '').trim());
  return found.length ? found.join(' ') : null;
}

const NEXT_TEST = /^\s*test(?:\.(?:only|skip|fixme|fail|slow))?\s*\(\s*['"`]/;
const STEP_CALL = /test\.step\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/** The `test.step('…')` titles between the test(...) line and the next test, as written in the source. */
export function stepTitles(lines: string[], line: number): string[] {
  let end = line;
  while (end < lines.length && !NEXT_TEST.test(lines[end])) end++;
  const block = lines.slice(line, end).join('\n');
  return [...block.matchAll(STEP_CALL)].map((m) => m[2]);
}

export async function listTestCases(serviceId: string): Promise<{ cases: TestCase[]; errors: string[] }> {
  const service = requireService(serviceId);
  scaffoldWorkspace(serviceId);
  const dir = testsDir(serviceId);
  const cli = require.resolve('@playwright/test/cli');

  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test', '--list', '--reporter=json', '--config', join(dir, 'playwright.config.ts')], {
      cwd: dir,
      env: { ...process.env, BASE_URL: service.baseUrl ?? '', PROBE_API: '', PROBE_RUN_ID: '' },
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => (child.kill(), reject(new Error('테스트 목록을 읽는 데 너무 오래 걸립니다'))), LIST_TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('error', (e) => (clearTimeout(timer), reject(e)));
    child.on('close', () => (clearTimeout(timer), resolve({ stdout: out, stderr: err })));
  });

  let json: { suites?: JsonSuite[]; errors?: { message?: string }[] };
  try {
    json = JSON.parse(stdout);
  } catch {
    const tail = stderr.replace(ANSI, '').trim().split('\n').slice(-5).join('\n');
    return { cases: [], errors: /No tests found/i.test(tail) ? [] : [tail || '테스트 목록을 읽지 못했습니다'] };
  }
  const cache = new Map<string, string[]>();
  const readSource = (file: string) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, readFileSync(join(dir, 'specs', file), 'utf8').split(/\r?\n/));
      } catch {
        cache.set(file, []);
      }
    }
    return cache.get(file)!;
  };
  // "No tests found" just means nothing has been written yet; the page shows that as its empty state.
  const errors = (json.errors ?? []).map((e) => (e.message ?? '').replace(ANSI, '').trim()).filter((m) => m && !/^Error: No tests found\.?$/i.test(m));
  return { cases: flattenSuites(json.suites ?? [], readSource), errors };
}

const TEST_DECL = /(^|[^\w.])test(?:\.(?:only|skip|fixme|fail|slow))?\s*\(\s*['"`]/g;

/**
 * How many tests the specs declare, counted from the source. Playwright's own list takes seconds;
 * this is only to know whether "run tests" has anything to run, so it is cheap and approximate.
 */
export function countTestCases(serviceId: string): number {
  const root = join(testsDir(serviceId), 'specs');
  let total = 0;
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.spec\.[cm]?[jt]s$/.test(e.name)) {
        try {
          total += (readFileSync(full, 'utf8').match(TEST_DECL) ?? []).length;
        } catch {
          /* unreadable file: counts as none */
        }
      }
    }
  };
  walk(root);
  return total;
}
