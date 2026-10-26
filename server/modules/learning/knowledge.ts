/** The Markdown files the learning job writes, and the user's hand edits to them. */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { badRequest } from '../../core/errors.ts';
import { broadcast } from '../../core/hub.ts';
import { knowledgeDir } from '../../config.ts';
import type { KnowledgeFile } from '../../../shared/models.ts';
import { requireService } from '../services/service.ts';
import { KNOWLEDGE_FILES } from './prompt.ts';

/** Known files first in their canonical order, anything extra after them alphabetically. */
export function sortKnowledgeNames(names: string[]): string[] {
  const rank = (n: string) => {
    const i = (KNOWLEDGE_FILES as readonly string[]).indexOf(n);
    return i === -1 ? KNOWLEDGE_FILES.length : i;
  };
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function listKnowledge(serviceId: string): KnowledgeFile[] {
  const dir = knowledgeDir(serviceId);
  if (!existsSync(dir)) return [];
  const names = sortKnowledgeNames(readdirSync(dir).filter((f) => f.endsWith('.md')));
  return names.map((name) => ({ name, content: readFileSync(join(dir, name), 'utf8'), updatedAt: statSync(join(dir, name)).mtimeMs }));
}

export const countKnowledge = (serviceId: string): number => listKnowledge(serviceId).length;

/** Only plain `*.md` names are accepted, so the name can never escape the knowledge folder. */
export function saveKnowledge(serviceId: string, name: string, content: string): void {
  requireService(serviceId);
  if (basename(name) !== name || !/^[\w.-]+\.md$/.test(name)) throw badRequest('Knowledge files must be plain .md names');
  writeFileSync(join(knowledgeDir(serviceId), name), content);
  broadcast({ type: 'service', serviceId });
}
