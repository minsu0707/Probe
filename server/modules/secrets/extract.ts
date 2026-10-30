/**
 * Finds the account details in a file that is not a .env or .enc: a spreadsheet, a CSV, a JSON, or
 * a note such as "아이디: admin / 비밀번호: ...". The owner should not have to reshape a file before
 * Probe will keep its values encrypted; this reads what is there and names the variables the way a
 * test would use them (ADMIN_ID, ADMIN_PW, ACCOUNT2_PW ...).
 *
 * Pure: bytes in, entries out. Nothing here stores or logs a value.
 */
import { parse as parseDotenv } from 'dotenv';
import { extractOoxmlText } from '../documents/ooxml.ts';

export type CredentialFormat = 'dotenv' | 'json' | 'table' | 'lines';

export interface Extracted {
  entries: Record<string, string>;
  format: CredentialFormat | null;
}

/** What a label means. The first matching row wins, so a password column is not mistaken for an id. */
const MEANING: { as: 'PW' | 'ID' | 'URL'; re: RegExp }[] = [
  { as: 'PW', re: /비밀\s*번호|비번|암호|패스워드|passw(?:or)?d|\bpwd?\b|\bpass\b/i },
  { as: 'ID', re: /아이디|계정|사용자|로그인|user\s*name|\buser(?:id)?\b|\blogin\b|\bid\b|\buid\b/i },
  { as: 'URL', re: /주소|사이트|\burl\b|\blink\b|링크/i },
];

/** The variable part a label stands for: PW, ID, URL, or the label itself when it is a plain ASCII name. Null when it is neither. */
export function columnOf(label: string): string | null {
  const text = label.trim();
  for (const m of MEANING) if (m.re.test(text)) return m.as;
  return /^[A-Za-z][A-Za-z0-9_ .-]{0,40}$/.test(text) ? asciiName(text) : null;
}

const asciiName = (text: string): string => text.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
const clean = (value: string): string => value.trim().replace(/^(["'`])(.*)\1$/, '$2').trim();

/** Bytes as text; spreadsheets and Word files are read for their text first. */
function textOf(name: string, bytes: Uint8Array): string {
  const ext = /\.(\w+)$/.exec(name.toLowerCase())?.[1];
  if (ext === 'xlsx' || ext === 'docx') {
    try {
      return extractOoxmlText(`.${ext}`, bytes);
    } catch {
      return '';
    }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes).replace(/^﻿/, '');
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
}

const DOTENV_LINE = /^(?:export\s+)?[A-Za-z_][\w.-]*\s*=/;

function dotenvEntries(text: string): Record<string, string> | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length || lines.filter((l) => DOTENV_LINE.test(l)).length / lines.length < 0.6) return null;
  const entries = parseDotenv(text);
  return Object.keys(entries).length ? entries : null;
}

/** One account's worth of fields, with the heading it was found under when there was one. */
interface Group {
  label?: string;
  fields: Record<string, string>;
}

/** Turns groups into variable names: bare names for a single account, ACCOUNT<n>_ or the heading as prefix for several. */
function nameGroups(groups: Group[]): Record<string, string> {
  const used = groups.filter((g) => Object.keys(g.fields).length);
  const out: Record<string, string> = {};
  const put = (key: string, value: string) => {
    let name = key;
    for (let n = 2; name in out; n++) name = `${key}_${n}`;
    out[name] = value;
  };
  used.forEach((g, i) => {
    const heading = g.label ? asciiName(g.label) : '';
    const prefix = heading || (used.length > 1 ? `ACCOUNT${i + 1}` : '');
    for (const [col, value] of Object.entries(g.fields)) put(prefix ? `${prefix}_${col}` : col === 'URL' ? 'BASE_URL' : col, value);
    // A heading in Hangul cannot be a variable name, so it is kept as a note the owner can read.
    if (g.label && !heading && used.length > 1) put(`${prefix}_LABEL`, g.label.trim());
  });
  return out;
}

function jsonEntries(text: string): Record<string, string> | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  const groups: Group[] = [];
  /** Objects whose leaves are fields become a group; an object of objects becomes several. */
  const walk = (value: unknown, label?: string): void => {
    if (Array.isArray(value)) return value.forEach((v) => walk(v));
    if (typeof value !== 'object' || value === null) return;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'object' && v !== null) walk(v, k);
      else if (v !== null && v !== undefined && String(v) !== '') {
        const col = columnOf(k);
        if (col) fields[col] = String(v);
      }
    }
    if (Object.keys(fields).length) groups.push({ label, fields });
  };
  walk(root);
  const entries = nameGroups(groups);
  return Object.keys(entries).length ? entries : null;
}

/** Cells of a delimited line; quotes protect a delimiter inside a value. */
function cells(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) (out.push(cur.trim()), (cur = ''));
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const NAMES_THE_ACCOUNT = /^(?:역할|구분|이름|성명|종류|유형|계정\s*구분|role|name|type|kind|label|account)$/i;

/** A sheet or CSV with a header row: each following row is an account, its columns named by the header. */
function tableGroups(lines: string[], delimiter: string): Group[] | null {
  const rows = lines.map((l) => cells(l, delimiter));
  const head = rows.findIndex((r) => r.some((c) => ['PW', 'ID'].includes(columnOf(c) ?? '')) && r.filter(Boolean).length >= 2);
  if (head < 0) return null;
  // A header such as 역할 or role says which account the row is; it names the account instead of being a field.
  const columns = rows[head].map((c) => (c && !NAMES_THE_ACCOUNT.test(c.trim()) ? columnOf(c) : null));
  const groups: Group[] = [];
  for (const row of rows.slice(head + 1)) {
    const fields: Record<string, string> = {};
    let label: string | undefined;
    row.forEach((value, i) => {
      const v = clean(value);
      if (!v) return;
      if (columns[i]) fields[columns[i]!] = v;
      else if (!label) label = v; // the first column without a meaning is what names the account (역할, 구분 ...)
    });
    if (fields.ID || fields.PW) groups.push({ label, fields });
  }
  return groups.length ? groups : null;
}

/** Notes: "라벨: 값", "라벨 = 값", "라벨<TAB>값", with an optional heading line above each account. */
function lineGroups(lines: string[]): Group[] {
  const groups: Group[] = [];
  let current: Group = { fields: {} };
  const flush = () => (Object.keys(current.fields).length ? groups.push(current) : undefined, (current = { fields: {} }));
  const pair = /^\s*(?:[-*•·]\s*)?(.{1,40}?)\s*(?:[:：=]|\t+)\s*(.+?)\s*$/;
  for (const [i, raw] of lines.entries()) {
    const m = pair.exec(raw);
    if (m) {
      const col = columnOf(m[1]);
      const value = clean(m[2]);
      if (!col || !value) continue;
      if (col in current.fields) flush(); // a second id or password starts the next account
      current.fields[col] = value;
    } else if (raw.length <= 30 && pair.test(lines[i + 1] ?? '')) {
      flush(); // a short line above a "라벨: 값" line is the heading of the account below it
      current.label = raw.replace(/^[\s\[\]()#*=-]+|[\s\[\]()#*=-]+$/g, '');
    }
  }
  flush();
  return groups;
}

export function extractCredentials(name: string, bytes: Uint8Array): Extracted {
  const text = textOf(name, bytes);

  const env = dotenvEntries(text);
  if (env) return { entries: env, format: 'dotenv' };

  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    const json = jsonEntries(trimmed);
    if (json) return { entries: json, format: 'json' };
  }

  // A sheet is tab-separated text with "=== Sheet ===" lines; a CSV is comma-separated.
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() && !/^===.*===$/.test(l.trim()));
  for (const delimiter of ['\t', ',']) {
    const delimited = lines.filter((l) => l.includes(delimiter));
    if (delimited.length >= 2 && delimited.length / lines.length >= 0.6) {
      const groups = tableGroups(delimited, delimiter);
      if (groups) return { entries: nameGroups(groups), format: 'table' };
    }
  }

  const entries = nameGroups(lineGroups(lines));
  return Object.keys(entries).length ? { entries, format: 'lines' } : { entries: {}, format: null };
}
