/**
 * The two event streams in the system.
 *
 *  - IngestEvent:   Playwright worker/reporter  →  server   (HTTP POST /api/ingest/:runId)
 *  - ServerMessage: server                      →  browser  (WebSocket /ws)
 */
import type { ActKind } from './actions.ts';
import type { Defect, Job, LogKind, QueuedMessage, RunSummary, Session, SessionMessage, TestStatus } from './models.ts';

export type IngestEvent =
  /** Sent once at the start: how many tests the run will attempt. */
  | { type: 'run:plan'; total: number }
  | { type: 'test:begin'; id: string; title: string[]; file: string; project: string }
  /** One Playwright action or `test.step`, shown in the log's "동작 단계". */
  | { type: 'step'; id: string; title: string }
  | { type: 'page'; id: string; url: string }
  /** Something the test typed, picked, pressed or sent (see shared/actions.ts). */
  | { type: 'act'; id: string; what: ActKind; target: string; value?: string }
  /** Emitted by the `view()` helper in specs. */
  | { type: 'view'; id: string; name: string; feature?: string }
  | {
      type: 'test:end';
      id: string;
      status: TestStatus;
      durationMs: number;
      retry: number;
      error?: string;
      errorStack?: string;
      /** Absolute paths inside the service's test workspace; the server copies them. */
      screenshot?: string;
      trace?: string;
    }
  | { type: 'run:end'; status: 'passed' | 'failed' | 'timedOut' | 'interrupted' };

/** Every event type the reporter may send; the server rejects anything else. */
export const INGEST_TYPES = ['run:plan', 'test:begin', 'step', 'page', 'act', 'view', 'test:end', 'run:end'] as const satisfies readonly IngestEvent['type'][];
// Fails to compile when an event type is added above but not to the list.
const _allListed: Exclude<IngestEvent['type'], (typeof INGEST_TYPES)[number]> extends never ? true : never = true;
void _allListed;

export type ServerMessage =
  | { type: 'run'; run: RunSummary }
  | { type: 'log'; runId: string; ts: number; kind: LogKind; text: string; status?: TestStatus }
  /** A new live screenshot is available at /api/runs/:id/live.jpg. */
  | { type: 'frame'; runId: string; ts: number }
  | { type: 'defect'; defect: Defect }
  | { type: 'defects:deleted'; serviceId: string; ids: string[] }
  /** Finished runs were removed from the history. */
  | { type: 'runs:deleted'; runIds: string[] }
  | { type: 'job'; job: Job }
  | { type: 'session'; session: Session }
  | { type: 'session:message'; message: SessionMessage }
  | { type: 'session:deleted'; sessionId: string; serviceId: string }
  /** The waiting messages of a session, in the order they will be sent. */
  | { type: 'session:queue'; sessionId: string; queue: QueuedMessage[] }
  /** A service's env, docs or knowledge changed; open pages should refetch. */
  | { type: 'service'; serviceId: string }
  | { type: 'docs'; serviceId: string }
  /** The Claude CLI's login state or login progress changed. */
  | { type: 'agent' };
