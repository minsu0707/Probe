import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { isolatedHome, tempDir } from './helpers.ts';

isolatedHome();
const { pack, unpack, safeTarget, BAD_BACKUP } = await import('../server/modules/backup/archive.ts');
const { applyPendingRestore, PENDING_NAME, STAGING_NAME } = await import('../server/core/restore-boot.ts');

const temp = () => tempDir('probe-bak-');
const sample = () => {
  const src = temp();
  writeFileSync(join(src, 'manifest.json'), '{"format":1}');
  writeFileSync(join(src, 'probe.db'), Buffer.alloc(300_000, 7)); // bigger than one stream chunk
  writeFileSync(join(src, 'empty.txt'), '');
  return src;
};

test('a backup unpacks to exactly what went in, including an empty file and a large one', async () => {
  const src = sample();
  const out = join(temp(), 'a.probebak');
  await pack(
    [
      { name: 'manifest.json', abs: join(src, 'manifest.json') },
      { name: 'probe.db', abs: join(src, 'probe.db') },
      { name: 'services/s1/knowledge/flows.md', abs: join(src, 'empty.txt') },
    ],
    'correct horse',
    out,
  );
  const dest = temp();
  const names = await unpack(out, 'correct horse', dest);
  assert.deepEqual(names, ['manifest.json', 'probe.db', 'services/s1/knowledge/flows.md']);
  assert.equal(readFileSync(join(dest, 'manifest.json'), 'utf8'), '{"format":1}');
  assert.ok(readFileSync(join(dest, 'probe.db')).equals(Buffer.alloc(300_000, 7)));
  assert.equal(readFileSync(join(dest, 'services', 's1', 'knowledge', 'flows.md'), 'utf8'), '');
});

test('a wrong passphrase, a damaged file and a foreign file are all refused with one clear message', async () => {
  const src = sample();
  const out = join(temp(), 'b.probebak');
  await pack([{ name: 'probe.db', abs: join(src, 'probe.db') }], 'right-pass-1', out);
  await assert.rejects(() => unpack(out, 'wrong-pass-1', temp()), new RegExp(BAD_BACKUP));

  const damaged = Buffer.from(readFileSync(out));
  damaged[damaged.length - 40] ^= 0xff;
  const damagedPath = join(temp(), 'c.probebak');
  writeFileSync(damagedPath, damaged);
  await assert.rejects(() => unpack(damagedPath, 'right-pass-1', temp()), new RegExp(BAD_BACKUP));

  const foreign = join(temp(), 'd.probebak');
  writeFileSync(foreign, Buffer.alloc(200, 1));
  await assert.rejects(() => unpack(foreign, 'x', temp()), /Probe 백업 파일이 아닙니다/);
});

test('names inside a backup can never write outside the folder being restored into', async () => {
  const dest = temp();
  assert.equal(safeTarget(dest, '../evil.txt'), null);
  assert.equal(safeTarget(dest, 'services/../../evil.txt'), null);
  assert.equal(safeTarget(dest, 'C:/evil.txt'), null);
  assert.equal(safeTarget(dest, 'other/file.txt'), null, 'only the known places');
  assert.ok(safeTarget(dest, 'services/s1/tests/specs/a.spec.ts')?.startsWith(dest));

  const src = sample();
  const out = join(temp(), 'e.probebak');
  await pack([{ name: 'services/../../evil.txt', abs: join(src, 'empty.txt') }], 'pass-word-1', out);
  await assert.rejects(() => unpack(out, 'pass-word-1', dest), /허용되지 않는 경로/);
});

test('a prepared restore replaces the data at the next start and keeps the old data to undo it', () => {
  const home = temp();
  mkdirSync(join(home, 'services', 'old'), { recursive: true });
  writeFileSync(join(home, 'probe.db'), 'OLD-DB');
  writeFileSync(join(home, 'master.key'), 'OLD-KEY');
  writeFileSync(join(home, 'services', 'old', 'note.md'), 'old');

  const staging = join(home, STAGING_NAME);
  mkdirSync(join(staging, 'services', 'new'), { recursive: true });
  writeFileSync(join(staging, 'manifest.json'), '{}');
  writeFileSync(join(staging, 'probe.db'), 'NEW-DB');
  writeFileSync(join(staging, 'master.key'), 'NEW-KEY');
  writeFileSync(join(staging, 'services', 'new', 'note.md'), 'new');
  writeFileSync(join(home, PENDING_NAME), '{}');

  assert.equal(applyPendingRestore(home), true);
  assert.equal(readFileSync(join(home, 'probe.db'), 'utf8'), 'NEW-DB');
  assert.equal(readFileSync(join(home, 'master.key'), 'utf8'), 'NEW-KEY');
  assert.ok(existsSync(join(home, 'services', 'new', 'note.md')));
  assert.ok(!existsSync(join(home, 'services', 'old')), 'the old services are gone from the live data');
  assert.ok(!existsSync(staging) && !existsSync(join(home, PENDING_NAME)));
  const [undo] = readdirSync(join(home, 'restore-undo'));
  assert.equal(readFileSync(join(home, 'restore-undo', undo, 'probe.db'), 'utf8'), 'OLD-DB');
  assert.equal(readFileSync(join(home, 'restore-undo', undo, 'services', 'old', 'note.md'), 'utf8'), 'old');

  assert.equal(applyPendingRestore(home), false, 'nothing left to do the second time');
});

test('a leftover marker without staged data does nothing', () => {
  const home = temp();
  writeFileSync(join(home, 'probe.db'), 'KEEP');
  writeFileSync(join(home, PENDING_NAME), '{}');
  assert.equal(applyPendingRestore(home), false);
  assert.equal(readFileSync(join(home, 'probe.db'), 'utf8'), 'KEEP');
  assert.ok(!existsSync(join(home, PENDING_NAME)));
});
