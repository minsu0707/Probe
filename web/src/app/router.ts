import { useEffect, useState } from 'react';

/**
 * Routing is just `location.hash`. Five fixed pages don't justify a router library, and a
 * hash route survives a reload without any server support.
 */
export const ROUTES = ['services', 'learn', 'monitor', 'results', 'settings'] as const;
export type Route = (typeof ROUTES)[number];

const read = (): Route => {
  const hash = location.hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(hash) ? (hash as Route) : 'services';
};

export const navigate = (route: Route): void => void (location.hash = `#/${route}`);

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
