/**
 * Publish a new version of the desktop app. Installed copies pick it up on their own.
 *
 *   npm run release              patch bump (0.2.0 -> 0.2.1)
 *   npm run release -- minor     or: major, or an exact version like 1.4.0
 *
 * What it does, in order: refuse unless the working tree is clean and on main; bump the version;
 * typecheck and test; commit and push the bump; build the installer and upload it (plus
 * latest.yml, which installed apps read) to a GitHub Release. The GitHub token comes from the
 * `gh` CLI login and is only passed to the build, never written anywhere.
 *
 * If a step after the bump fails, nothing is rolled back: fix the problem and run
 * `npm run release -- <the printed version>` again.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/config.ts';

const BUMPS = ['patch', 'minor', 'major'];

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env, capture = false): string {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, shell: true, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (r.status !== 0) {
    console.error(`\nrelease: "${cmd} ${args.join(' ')}" failed`);
    process.exit(1);
  }
  return (r.stdout ?? '').trim();
}

const version = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;

const arg = process.argv[2] ?? 'patch';
if (!BUMPS.includes(arg) && !/^\d+\.\d+\.\d+$/.test(arg)) {
  console.error('usage: npm run release -- [patch|minor|major|x.y.z]');
  process.exit(2);
}

if (run('git', ['status', '--porcelain'], process.env, true)) {
  console.error('release: the working tree has uncommitted changes. Commit or stash them first.');
  process.exit(1);
}
if (run('git', ['branch', '--show-current'], process.env, true) !== 'main') {
  console.error('release: switch to the main branch first.');
  process.exit(1);
}

const token = run('gh', ['auth', 'token'], process.env, true);
if (!token) {
  console.error('release: not signed in to GitHub. Run `gh auth login` first.');
  process.exit(1);
}

// Re-running with the version that a failed attempt already wrote must not bump again.
if (version() !== arg) run('npm', ['version', arg, '--no-git-tag-version']);
const next = version();
console.log(`\nrelease: version ${next}\n`);

run('npm', ['run', 'typecheck']);
run('npm', ['test']);

run('git', ['add', 'package.json', 'package-lock.json']);
run('git', ['commit', '-m', `"Release v${next}"`, '--allow-empty']);
run('git', ['push', 'origin', 'main']);

run('npm', ['run', 'build']);
run('npx', ['electron-builder', '--win', '--publish', 'always'], { ...process.env, GH_TOKEN: token });

// The build leaves a draft: installed apps cannot see it, so none of them checks during the minutes the
// installer is still uploading. Publishing is the last step, once latest.yml and the installer are both there.
const assets = run('gh', ['release', 'view', `v${next}`, '--repo', 'minsu0707/Probe', '--json', 'assets', '-q', '".assets[].name"'], process.env, true);
if (!/latest\.yml/.test(assets) || !/\.exe\b/.test(assets)) {
  console.error(`\nrelease: the draft v${next} is missing files (found: ${assets.replace(/\s+/g, ' ') || 'none'}). Not publishing.`);
  process.exit(1);
}
run('gh', ['release', 'edit', `v${next}`, '--repo', 'minsu0707/Probe', '--draft=false', '--latest']);
console.log(`\nrelease: v${next} published. Installed apps will download it within hours, or on "지금 확인".`);
