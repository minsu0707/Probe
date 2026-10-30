/**
 * Report what a test does in the service, so the dashboard can show it: the pages it visits,
 * what it types or presses, and the write requests it sends.
 *
 * Playwright raises no event for these (an API call made through `context.request` is invisible
 * to the context, and a `fill` is only a step title without its value), so the few methods that
 * matter are wrapped once per worker. The wrappers only report; the call itself is unchanged and
 * a failure to report never reaches the test.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { isSecretTarget, readableTarget, shorten, type ActKind } from '../shared/actions.ts';
import { send } from './transport.ts';

let installed = false;
/** The test running right now in this worker (workers run one test at a time). */
let testId: string | null = null;
export const setCurrentTest = (id: string | null) => void (testId = id);

const report = (what: ActKind, target: string, value?: string) => {
  if (!testId) return;
  const secret = isSecretTarget(target);
  void send([{ type: 'act', id: testId, what, target: shorten(target, 80), value: value === undefined ? undefined : secret ? '••••' : shorten(value) }]).catch(() => undefined);
};

/** Wrap `proto[name]` so `before(this, args)` runs first; reporting errors are swallowed. */
function wrap(proto: any, name: string, before: (self: any, args: any[]) => void): void {
  const original = proto?.[name];
  if (typeof original !== 'function') return;
  proto[name] = function (...args: any[]) {
    try {
      before(this, args);
    } catch {
      /* reporting must not change the test */
    }
    return original.apply(this, args);
  };
}

const text = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : typeof v === 'string' ? v : JSON.stringify(v));

/** `selectOption` takes a value, a label, or lists/objects of them. */
const picked = (v: any): string | undefined => (Array.isArray(v) ? v.map(picked).join(', ') : typeof v === 'object' && v ? String(v.label ?? v.value ?? v.index) : text(v));

function hookContext(context: BrowserContext): void {
  const watch = (page: Page) => {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url() !== 'about:blank' && testId) void send([{ type: 'page', id: testId, url: frame.url() }]).catch(() => undefined);
    });
  };
  context.pages().forEach(watch);
  context.on('page', watch);
}

/** Install the wrappers; safe to call for every test, it only does anything the first time. */
export function instrument(browser: Browser, page: Page): void {
  if (installed) return;
  installed = true;

  const locator = Object.getPrototypeOf(page.locator('body'));
  wrap(locator, 'fill', (l, [v]) => report('fill', readableTarget(String(l)), text(v)));
  wrap(locator, 'pressSequentially', (l, [v]) => report('fill', readableTarget(String(l)), text(v)));
  wrap(locator, 'selectOption', (l, [v]) => report('select', readableTarget(String(l)), picked(v)));
  wrap(locator, 'check', (l) => report('check', readableTarget(String(l))));
  wrap(locator, 'setChecked', (l, [on]) => report('check', readableTarget(String(l)), on ? '켬' : '끔'));
  wrap(locator, 'click', (l) => report('click', readableTarget(String(l))));
  wrap(locator, 'press', (l, [key]) => report('press', readableTarget(String(l)), text(key)));
  wrap(locator, 'setInputFiles', (l, [files]) => report('upload', readableTarget(String(l)), Array.isArray(files) ? files.map((f) => String(f.name ?? f).split(/[\\/]/).pop()).join(', ') : String(files?.name ?? files).split(/[\\/]/).pop()));

  // get/post/put/patch/delete all go through fetch; only requests that change something are worth a node.
  wrap(Object.getPrototypeOf(page.request), 'fetch', (_api, [urlOrRequest, options]) => {
    const method = String(options?.method ?? urlOrRequest?.method?.() ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') return;
    const url = typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest?.url?.() ?? '';
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    report('request', `${method} ${path}`, text(options?.data ?? options?.form ?? undefined));
  });

  // Specs often open their own context (to sign in through the API first), so every context is watched.
  const proto = Object.getPrototypeOf(browser);
  const newContext = proto.newContext;
  proto.newContext = async function (...args: any[]) {
    const context = await newContext.apply(this, args);
    try {
      hookContext(context);
    } catch {
      /* the test still gets its context */
    }
    return context;
  };
}
