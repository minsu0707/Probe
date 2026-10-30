import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractCredentials } from '../server/modules/secrets/extract.ts';

const read = (name: string, text: string) => extractCredentials(name, new TextEncoder().encode(text));

test('a plain .env is read as before, whatever the file is called', () => {
  const r = read('accounts.txt', 'ADMIN_ID=admin\nADMIN_PW=s3cret!\n# note\nBASE_URL=https://x.example');
  assert.equal(r.format, 'dotenv');
  assert.deepEqual(r.entries, { ADMIN_ID: 'admin', ADMIN_PW: 's3cret!', BASE_URL: 'https://x.example' });
});

test('a note with Korean labels becomes ID and PW', () => {
  const r = read('계정.txt', '아이디: qa-admin\n비밀번호: p@ss:word\n주소: https://foodrnd.example');
  assert.equal(r.format, 'lines');
  assert.deepEqual(r.entries, { ID: 'qa-admin', PW: 'p@ss:word', BASE_URL: 'https://foodrnd.example' }); // a colon inside the password stays
});

test('several accounts in a note are told apart by their headings, or numbered', () => {
  const headed = read('a.txt', 'ADMIN\n아이디: a1\n비밀번호: pw-a\n\nRES2\n아이디: r2\n비밀번호: pw-r');
  assert.deepEqual(headed.entries, { ADMIN_ID: 'a1', ADMIN_PW: 'pw-a', RES2_ID: 'r2', RES2_PW: 'pw-r' });

  const numbered = read('b.txt', '아이디: a1\n비밀번호: pw-a\n아이디: r2\n비밀번호: pw-r');
  assert.deepEqual(numbered.entries, { ACCOUNT1_ID: 'a1', ACCOUNT1_PW: 'pw-a', ACCOUNT2_ID: 'r2', ACCOUNT2_PW: 'pw-r' });

  const korean = read('c.txt', '관리자\n아이디: a1\n비밀번호: pw-a\n연구원\n아이디: r2\n비밀번호: pw-r');
  assert.equal(korean.entries.ACCOUNT1_PW, 'pw-a');
  assert.equal(korean.entries.ACCOUNT2_LABEL, '연구원'); // a Hangul heading cannot be a variable name, so it is kept as a note
});

test('a CSV with a header row gives one account per row', () => {
  const r = read('users.csv', '역할,아이디,비밀번호\nADMIN,admin1,"pw,with,commas"\nRES2,res2,pw2');
  assert.equal(r.format, 'table');
  assert.deepEqual(r.entries, { ADMIN_ID: 'admin1', ADMIN_PW: 'pw,with,commas', RES2_ID: 'res2', RES2_PW: 'pw2' });
});

test('spreadsheet text (tab separated, with a sheet line) is a table too', () => {
  const sheet = '=== Sheet: 계정 ===\nrole\tid\tpassword\nadmin\ta1\tpw-a\nuser\tu1\tpw-u';
  const r = read('x.txt', sheet);
  assert.equal(r.format, 'table');
  assert.deepEqual(r.entries, { ADMIN_ID: 'a1', ADMIN_PW: 'pw-a', USER_ID: 'u1', USER_PW: 'pw-u' });
});

test('JSON: a flat object, nested accounts, and a list of accounts', () => {
  assert.deepEqual(read('a.json', '{"username":"u","password":"p","token":"t0k"}').entries, { ID: 'u', PW: 'p', TOKEN: 't0k' });
  assert.deepEqual(read('b.json', '{"admin":{"id":"a","pw":"x"},"res2":{"id":"r","pw":"y"}}').entries, { ADMIN_ID: 'a', ADMIN_PW: 'x', RES2_ID: 'r', RES2_PW: 'y' });
  assert.deepEqual(read('c.json', '[{"id":"a","pw":"x"},{"id":"b","pw":"y"}]').entries, { ACCOUNT1_ID: 'a', ACCOUNT1_PW: 'x', ACCOUNT2_ID: 'b', ACCOUNT2_PW: 'y' });
});

test('a UTF-16 file (what some editors save) is read, and a BOM does not leak into a name', () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('ID=a\nPW=b', 'utf16le')]);
  assert.deepEqual(extractCredentials('u16.txt', utf16).entries, { ID: 'a', PW: 'b' });
  assert.deepEqual(read('bom.env', '﻿ID=a\nPW=b').entries, { ID: 'a', PW: 'b' });
});

test('text with no account details yields nothing, and ordinary prose is not mistaken for accounts', () => {
  assert.deepEqual(read('manual.txt', '제품 등록 방법\n1. 메뉴를 연다\n2. 저장을 누른다').entries, {});
  assert.equal(read('manual.txt', '제품 등록 방법\n1. 메뉴를 연다').format, null);
  assert.deepEqual(read('empty.txt', '').entries, {});
});

test('a name that is not ASCII is skipped rather than invented', () => {
  assert.deepEqual(read('n.txt', '제품명: 누드빼빼로\n아이디: a\n비밀번호: b').entries, { ID: 'a', PW: 'b' });
});

test('a real .xlsx workbook is read: header row, one account per row', async () => {
  const { strToU8, zipSync } = await import('fflate');
  const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
  const strings = ['역할', '아이디', '비밀번호', 'ADMIN', 'admin1', 'pw-admin', 'RES2', 'res2', 'pw-res'];
  const cell = (ref: string, i: number) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
  const data = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="계정" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1">${cell('A1', 0)}${cell('B1', 1)}${cell('C1', 2)}</row><row r="2">${cell('A2', 3)}${cell('B2', 4)}${cell('C2', 5)}</row><row r="3">${cell('A3', 6)}${cell('B3', 7)}${cell('C3', 8)}</row></sheetData></worksheet>`,
  });
  const r = extractCredentials('계정.xlsx', data);
  assert.equal(r.format, 'table');
  assert.deepEqual(r.entries, { ADMIN_ID: 'admin1', ADMIN_PW: 'pw-admin', RES2_ID: 'res2', RES2_PW: 'pw-res' });
});

test('a broken workbook is not an error, just nothing found', () => {
  assert.deepEqual(extractCredentials('broken.xlsx', new Uint8Array([1, 2, 3])).entries, {});
});
