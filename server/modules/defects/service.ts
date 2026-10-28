/**
 * Defects: failed tests become "candidate" defects automatically; identical failures are
 * merged into one defect whose occurrence count goes up. People (and Claude) then triage.
 */
import { badRequest, notFound } from '../../core/errors.ts';
import { broadcast } from '../../core/hub.ts';
import { newId } from '../../core/ids.ts';
import { testsDir } from '../../config.ts';
import type { AnswerVerdict, Defect, DefectStatus, Severity } from '../../../shared/models.ts';
import { requireService } from '../services/service.ts';
import { keepAttachment } from './attachments.ts';
import { failureFingerprint, guessSeverity, manualFingerprint, stripAnsi } from './classify.ts';
import * as repo from './repository.ts';

export const listDefects = repo.list;
export const countOpenDefects = repo.countOpen;
export const countRunDefects = repo.countForRun;

const STATUSES: DefectStatus[] = ['candidate', 'confirmed', 'false_positive', 'fixed'];
const SEVERITIES: Severity[] = ['critical', 'major', 'minor'];

export interface FailureInput {
  serviceId: string;
  runId: string;
  /** Test title path without file/project, e.g. ['장바구니', '합계가 …']. */
  testTitle: string[];
  feature: string | null;
  page: string | null;
  error?: string;
  /** Absolute paths from the reporter. */
  screenshot?: string;
  trace?: string;
  /** The earlier failure in the same file and run that this one probably follows from. */
  followsId?: string;
}

/** Create the defect, or add an occurrence to the open one with the same fingerprint. */
export function recordFailure(f: FailureInput): Defect {
  const error = stripAnsi(f.error ?? 'Test failed without an error message').trim();
  const fingerprint = failureFingerprint(f.serviceId, f.testTitle, error);
  const root = testsDir(f.serviceId);
  const screenshot = keepAttachment(f.runId, f.screenshot, root);
  const trace = keepAttachment(f.runId, f.trace, root);
  const now = Date.now();

  const existing = repo.findOpenByFingerprint(f.serviceId, fingerprint);
  const id = existing?.id ?? newId();
  if (existing) {
    repo.recordOccurrence(id, { runId: f.runId, seenAt: now, page: f.page, error, screenshot, trace });
  } else {
    repo.insert({
      id, serviceId: f.serviceId, runId: f.runId, fingerprint, title: f.testTitle[f.testTitle.length - 1], severity: guessSeverity(error), status: 'candidate',
      page: f.page, feature: f.feature, error, screenshot, trace, firstSeen: now, lastSeen: now, followsId: f.followsId ?? null,
    });
  }
  return publish(id);
}

/** A defect Claude found without a failing assertion (e.g. while exploring or reading code). */
export function reportDefect(input: { serviceId: string; title: string; detail: string; severity?: Severity; page?: string; feature?: string; runId?: string }): Defect {
  requireService(input.serviceId);
  const title = input.title.trim();
  if (!title) throw badRequest('title is required');
  const now = Date.now();
  const id = newId();
  repo.insert({
    id, serviceId: input.serviceId, runId: input.runId ?? '', fingerprint: manualFingerprint(input.serviceId, title), title, severity: input.severity ?? 'major', status: 'candidate',
    page: input.page ?? null, feature: input.feature ?? null, error: input.detail, screenshot: null, trace: null, firstSeen: now, lastSeen: now,
  });
  return publish(id);
}

export function updateDefect(id: string, patch: { status?: string; severity?: string; title?: string }): Defect {
  const current = repo.findById(id);
  if (!current) throw notFound('Defect not found');
  if (patch.status && !STATUSES.includes(patch.status as DefectStatus)) throw badRequest('Bad status');
  if (patch.severity && !SEVERITIES.includes(patch.severity as Severity)) throw badRequest('Bad severity');
  repo.updateFields(id, { status: patch.status ?? current.status, severity: patch.severity ?? current.severity, title: patch.title?.trim() || current.title });
  return publish(id);
}

/** "App bug" confirms the defect; every other answer means it is not a defect of the app. */
const VERDICT_STATUS: Record<AnswerVerdict, DefectStatus> = { app: 'confirmed', intended: 'false_positive', test: 'false_positive', env: 'false_positive' };
const VERDICTS = Object.keys(VERDICT_STATUS) as AnswerVerdict[];
export const recentAnswers = repo.recentAnswers;

/** The owner looked at the screen and decided. Remembered per failure, applied to the status, and handed to Claude from then on. */
export function answerDefect(id: string, input: { verdict: string; note?: string }): Defect {
  const defect = repo.findById(id);
  if (!defect) throw notFound('Defect not found');
  if (!VERDICTS.includes(input.verdict as AnswerVerdict)) throw badRequest('Bad answer');
  const verdict = input.verdict as AnswerVerdict;
  const where = [defect.feature, defect.page].filter(Boolean).join(' · ');
  const subject = `${defect.title}${where ? ` (${where})` : ''} — ${defect.error.split('\n')[0].slice(0, 160)}`;
  repo.saveAnswer(defect.serviceId, defect.fingerprint, { verdict, note: (input.note ?? '').trim().slice(0, 1000), subject, now: Date.now() });
  repo.updateFields(id, { status: VERDICT_STATUS[verdict], severity: defect.severity, title: defect.title });
  return publish(id);
}

export function clearAnswer(id: string): Defect {
  const defect = repo.findById(id);
  if (!defect) throw notFound('Defect not found');
  repo.removeAnswer(defect.serviceId, defect.fingerprint);
  return publish(id);
}

/** Remove defects for good (the owner asked, directly or through Claude). The screenshots stay in their run's folder. */
export function deleteDefects(serviceId: string, ids: string[]): string[] {
  requireService(serviceId);
  const removed = repo.removeMany(serviceId, [...new Set(ids)]);
  if (removed.length) broadcast({ type: 'defects:deleted', serviceId, ids: removed });
  return removed;
}

/** Re-read from the database so what is broadcast is exactly what is stored. */
function publish(id: string): Defect {
  const defect = repo.findById(id)!;
  broadcast({ type: 'defect', defect });
  return defect;
}
