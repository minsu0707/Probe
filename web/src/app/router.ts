import { useEffect, useState } from 'react';

/**
 * Routing is just `location.hash`; a handful of pages don't justify a router library, and a
 * hash route survives a reload without any server support.
 *
 *   #/s/<serviceId>/<tab>      one service, one of its tabs
 *   #/settings/<section>       the settings page, one of its sections
 *   (anything else)            home: the first service, or a welcome page
 */
export const TABS = ['overview', 'learn', 'monitor', 'results'] as const;
export type Tab = (typeof TABS)[number];

export const SETTINGS_SECTIONS = ['agent', 'security', 'browser', 'general', 'integrations'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export type Route =
  | { page: 'home' }
  | { page: 'service'; serviceId: string; tab: Tab }
  | { page: 'settings'; section: SettingsSection };

const isOneOf = <T extends string>(list: readonly T[], v: string | undefined): v is T => list.includes(v as T);

/** Pure so it can be unit-tested; `hash` is `location.hash`. */
export function parseRoute(hash: string): Route {
  const [head, a, b] = hash.replace(/^#\/?/, '').split('/');
  if (head === 's' && a) return { page: 'service', serviceId: decodeURIComponent(a), tab: isOneOf(TABS, b) ? b : 'overview' };
  if (head === 'settings') return { page: 'settings', section: isOneOf(SETTINGS_SECTIONS, a) ? a : 'agent' };
  return { page: 'home' };
}

export const serviceHref = (serviceId: string, tab: Tab = 'overview'): string => `#/s/${encodeURIComponent(serviceId)}/${tab}`;
export const settingsHref = (section: SettingsSection = 'agent'): string => `#/settings/${section}`;

export const goService = (serviceId: string, tab: Tab = 'overview'): void => void (location.hash = serviceHref(serviceId, tab));
export const goSettings = (section: SettingsSection = 'agent'): void => void (location.hash = settingsHref(section));

export function useRoute(): Route {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  // Parsing on every render would hand out a new object each time; keyed on the hash it is stable enough
  // for effects, which compare the fields they use.
  return parseRoute(hash);
}
