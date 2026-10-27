/** Registering, editing and removing services. Pure business rules; SQL lives in repository.ts. */
import { badRequest, conflict, notFound } from '../../core/errors.ts';
import { broadcast } from '../../core/hub.ts';
import { newId } from '../../core/ids.ts';
import type { Service } from '../../../shared/models.ts';
import { refreshFavicon } from './favicon.ts';
import * as repo from './repository.ts';
import { removeWorkspace, scaffoldWorkspace } from './workspace.ts';

export const listServices = repo.findAll;
export const getService = repo.findById;

export function requireService(id: string): Service {
  const s = repo.findById(id);
  if (!s) throw notFound(`Service ${id} not found`);
  return s;
}

/**
 * Accepts only http(s) URLs and drops a trailing slash, so "https://x.com/" and
 * "https://x.com" are the same baseURL. Empty input means "no URL".
 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest(`Not a valid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw badRequest('URL must start with http:// or https://');
  return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/$/, ''));
}

export function createService(input: { name: string; baseUrl?: string; notes?: string; readOnly?: boolean }): Service {
  const name = input.name?.trim();
  if (!name) throw badRequest('Service name is required');
  if (repo.nameTaken(name)) throw conflict(`A service named "${name}" already exists`);

  const service: Service = { id: newId(), name, baseUrl: normalizeUrl(input.baseUrl), notes: input.notes?.trim() || null, readOnly: input.readOnly === true, createdAt: Date.now() };
  repo.insert(service);
  scaffoldWorkspace(service.id);
  broadcast({ type: 'service', serviceId: service.id });
  if (service.baseUrl) void refreshFavicon(service.id);
  return service;
}

/** `undefined` leaves a field alone; `null` clears it. */
export function updateService(id: string, patch: { name?: string; baseUrl?: string | null; notes?: string | null; readOnly?: boolean }): Service {
  const current = requireService(id);
  repo.update({
    id,
    name: patch.name?.trim() || current.name,
    baseUrl: patch.baseUrl === undefined ? current.baseUrl : normalizeUrl(patch.baseUrl),
    notes: patch.notes === undefined ? current.notes : patch.notes?.trim() || null,
    readOnly: patch.readOnly === undefined ? current.readOnly : patch.readOnly,
  });
  broadcast({ type: 'service', serviceId: id });
  const updated = requireService(id);
  if (updated.baseUrl !== current.baseUrl) void refreshFavicon(id);
  return updated;
}

/** Cascades to secrets, documents, runs, defects and jobs; the workspace folder goes too. */
export function deleteService(id: string): void {
  requireService(id);
  repo.remove(id);
  removeWorkspace(id);
  broadcast({ type: 'service', serviceId: id });
}
