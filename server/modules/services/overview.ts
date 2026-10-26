/**
 * The per-service summary the UI lists. It reads from several modules, so it sits at the top
 * of the dependency order: services → (secrets, documents, learning, runs, defects) is allowed
 * here, but none of those modules may import this file.
 */
import type { ServiceOverview } from '../../../shared/models.ts';
import { countOpenDefects } from '../defects/service.ts';
import { countDocs, countUnlearnedDocs } from '../documents/service.ts';
import { countKnowledge } from '../learning/knowledge.ts';
import { isLearning } from '../learning/service.ts';
import { countSecrets } from '../secrets/service.ts';
import { isSessionRunning } from '../sessions/service.ts';
import { activeRun, listRuns } from '../runs/service.ts';
import { requireService } from './service.ts';

export function serviceOverview(id: string): ServiceOverview {
  return {
    ...requireService(id),
    secretCount: countSecrets(id),
    docCount: countDocs(id),
    unlearnedDocs: countUnlearnedDocs(id),
    knowledgeCount: countKnowledge(id),
    openDefects: countOpenDefects(id),
    lastRun: listRuns(id, 1)[0] ?? null,
    activeRun: activeRun(id) ?? null,
    learning: isLearning(id),
    claudeWorking: isSessionRunning(id),
  };
}
