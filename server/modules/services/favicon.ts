/**
 * A service's own favicon, shown next to it in the sidebar. It is fetched from the service's
 * URL when that URL is set or changed, kept in the service folder, and served back by the API.
 * Best effort: a service without an icon, or one that is down, simply keeps the letter avatar.
 */
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, serviceDir } from '../../config.ts';
import { broadcast } from '../../core/hub.ts';
import { findAll, findById } from './repository.ts';

const MAX_ICON_BYTES = 256 * 1024;
const MAX_PAGE_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

const iconFile = (id: string) => join(serviceDir(id), 'favicon');
const typeFile = (id: string) => join(serviceDir(id), 'favicon.type');

/** Where the icon of `<link rel="icon">` points, resolved against the page. Falls back to /favicon.ico. */
export function findIconUrl(html: string, pageUrl: string): string {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined);
  const candidates = links
    .map((tag) => ({ rel: (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/), href: attr(tag, 'href') }))
    .filter((l) => l.href && l.rel.some((t) => t === 'icon' || t === 'apple-touch-icon'));
  // Plain icons first: apple-touch-icon is often a large PNG that blurs when shrunk.
  const best = candidates.find((l) => !l.rel.includes('apple-touch-icon')) ?? candidates[0];
  try {
    return new URL(best?.href ?? '/favicon.ico', pageUrl).href;
  } catch {
    return new URL('/favicon.ico', pageUrl).href;
  }
}

/** Only http(s), images, and a size cap: the bytes are served back to the page, so they are checked. */
const SNIFF: [string, number[]][] = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46]],
  ['image/x-icon', [0x00, 0x00, 0x01, 0x00]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]],
];
function imageType(bytes: Uint8Array, declared: string | null): string | null {
  const hit = SNIFF.find(([, magic]) => magic.every((b, i) => bytes[i] === b));
  if (hit) return hit[0];
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if ((declared?.includes('svg') || head.startsWith('<?xml') || head.startsWith('<svg')) && head.includes('<svg')) return 'image/svg+xml';
  return null;
}

async function get(url: string, limit: number): Promise<{ bytes: Uint8Array; type: string | null; finalUrl: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow', headers: { 'user-agent': 'Probe favicon fetch' } });
    if (!res.ok || !/^https?:$/.test(new URL(res.url).protocol)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > limit) return null;
    return { bytes, type: res.headers.get('content-type'), finalUrl: res.url };
  } catch {
    return null;
  }
}

/** Downloads the favicon of a site, or null when it has none. */
export async function fetchFavicon(baseUrl: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const attempts: string[] = [];
  const page = await get(baseUrl, MAX_PAGE_BYTES);
  if (page) attempts.push(findIconUrl(new TextDecoder().decode(page.bytes), page.finalUrl));
  attempts.push(new URL('/favicon.ico', baseUrl).href);
  for (const url of new Set(attempts)) {
    const icon = await get(url, MAX_ICON_BYTES);
    const type = icon && imageType(icon.bytes, icon.type);
    if (icon && type) return { bytes: icon.bytes, type };
  }
  return null;
}

/** Fetches and stores the icon for the service's current URL; removes it when there is none. */
export async function refreshFavicon(serviceId: string): Promise<void> {
  const service = findById(serviceId);
  if (!service) return;
  const icon = service.baseUrl ? await fetchFavicon(service.baseUrl) : null;
  // The service may have been deleted or pointed elsewhere while the request was in flight.
  if (findById(serviceId)?.baseUrl !== service.baseUrl) return;
  if (!icon) {
    if (!existsSync(iconFile(serviceId))) return;
    rmSync(iconFile(serviceId), { force: true });
    rmSync(typeFile(serviceId), { force: true });
  } else {
    ensureDir(serviceDir(serviceId));
    writeFileSync(iconFile(serviceId), icon.bytes);
    writeFileSync(typeFile(serviceId), icon.type);
  }
  broadcast({ type: 'service', serviceId });
}

/** Version for cache-busting the image URL (file time), or null when there is no icon. */
export function faviconVersion(serviceId: string): number | null {
  try {
    return Math.floor(statSync(iconFile(serviceId)).mtimeMs);
  } catch {
    return null;
  }
}

export function readFavicon(serviceId: string): { bytes: Uint8Array; type: string } | null {
  if (!existsSync(iconFile(serviceId))) return null;
  const type = existsSync(typeFile(serviceId)) ? readFileSync(typeFile(serviceId), 'utf8') : 'image/x-icon';
  return { bytes: new Uint8Array(readFileSync(iconFile(serviceId))), type };
}

/** Services that have a URL but no stored icon (added before this feature, or the site was down) get one more try at startup. */
export function refreshMissingFavicons(): void {
  for (const s of findAll()) if (s.baseUrl && faviconVersion(s.id) === null) void refreshFavicon(s.id);
}
