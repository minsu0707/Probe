import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { isolatedHome } from './helpers.ts';

isolatedHome();
const { findIconUrl, fetchFavicon, refreshFavicon, faviconVersion, readFavicon } = await import('../server/modules/services/favicon.ts');
const services = await import('../server/modules/services/service.ts');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

test('findIconUrl reads the rel=icon link, resolves it against the page, and skips mask and touch icons', () => {
  const html = `<head><link rel="mask-icon" href="/m.svg"><link rel="apple-touch-icon" href="/touch.png"><link href='/img/fav.png' rel='shortcut icon'></head>`;
  assert.equal(findIconUrl(html, 'https://x.test/app/'), 'https://x.test/img/fav.png');
  assert.equal(findIconUrl('<link rel="apple-touch-icon" href="t.png">', 'https://x.test/app/'), 'https://x.test/app/t.png');
  assert.equal(findIconUrl('<html></html>', 'https://x.test/a/b'), 'https://x.test/favicon.ico');
});

test('a service gets its favicon from the page, and loses it when the site has none', async () => {
  let hasIcon = true;
  const site = createServer((req, res) => {
    if (req.url === '/') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<link rel="icon" href="/brand.png">');
    if (req.url === '/brand.png' && hasIcon) return void res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  try {
    const fetched = await fetchFavicon(url);
    assert.equal(fetched?.type, 'image/png');

    const s = services.createService({ name: 'Iconic' });
    assert.equal(faviconVersion(s.id), null);
    services.updateService(s.id, { baseUrl: url });
    for (let i = 0; i < 50 && faviconVersion(s.id) === null; i++) await new Promise((r) => setTimeout(r, 50));
    assert.notEqual(faviconVersion(s.id), null);
    assert.deepEqual(Buffer.from(readFavicon(s.id)!.bytes), PNG);

    hasIcon = false;
    await refreshFavicon(s.id);
    assert.equal(faviconVersion(s.id), null);
  } finally {
    site.close();
  }
});

test('something that is not an image is never stored', async () => {
  const site = createServer((_req, res) => void res.writeHead(200, { 'content-type': 'image/png' }).end('<html>not an image</html>'));
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  try {
    assert.equal(await fetchFavicon(`http://127.0.0.1:${(site.address() as AddressInfo).port}`), null);
  } finally {
    site.close();
  }
});
