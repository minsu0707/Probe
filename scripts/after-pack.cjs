// electron-builder hook: fail the build when a file the app needs at run time did not make it
// into the package. The "files" globs drop folders named test/docs/... from node_modules, and
// that once removed @playwright/test, so every test run in the installed app failed.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const REQUIRED = ['node_modules/@playwright/test/cli.js', 'node_modules/playwright-core/package.json', 'node_modules/hono/package.json', 'dist/index.html', 'server/main.ts'];

exports.default = async function afterPack(context) {
  const app = join(context.appOutDir, 'resources', 'app');
  const missing = REQUIRED.filter((p) => !existsSync(join(app, p)));
  if (missing.length) throw new Error(`Package is missing: ${missing.join(', ')}`);
};
