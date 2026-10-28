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
// installer is still uploading. electron-builder uploads the files in parallel and can end up creating
// the same release twice, each with some of the files, so look at every release with this tag, publish
// the one that has everything, and delete the incomplete drafts.
interface Rel {
  id: number;
  draft: boolean;
  assets: { name: string }[];
}
const REPO = 'minsu0707/Probe';
const releases = (JSON.parse(run('gh', ['api', `repos/${REPO}/releases?per_page=30`], process.env, true)) as (Rel & { tag_name: string })[]).filter((r) => r.tag_name === `v${next}`);
const complete = (r: Rel) => r.assets.some((a) => a.name === 'latest.yml') && r.assets.some((a) => a.name.endsWith('.exe'));
const best = releases.filter(complete).sort((a, b) => b.assets.length - a.assets.length)[0];
if (!best) {
  console.error(`\nrelease: no release of v${next} has both latest.yml and the installer yet (found: ${releases.map((r) => r.assets.map((a) => a.name).join('+') || 'empty').join(' | ') || 'none'}). Not publishing; run this again with the same version.`);
  process.exit(1);
}
for (const r of releases) if (r.id !== best.id && r.draft) run('gh', ['api', '-X', 'DELETE', `repos/${REPO}/releases/${r.id}`], process.env, true);
if (best.draft) run('gh', ['api', '-X', 'PATCH', `repos/${REPO}/releases/${best.id}`, '-F', 'draft=false', '-f', 'make_latest=true'], process.env, true);
console.log(`\nrelease: v${next} published. Installed apps will download it within hours, or on "지금 확인".`);
