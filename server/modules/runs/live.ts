/**
 * Runs that are executing right now. This is in-memory on purpose: it holds things that
 * must not be persisted (the ingest token, the child process, the latest screenshot).
 * The database stores the durable summary; this map is the authority only while a run lives.
 */
import type { ChildProcess } from 'node:child_process';
import type { RunSummary } from '../../../shared/models.ts';
import type { RunState } from './reduce.ts';

export interface LiveRun extends RunState {
  /** Authenticates /api/ingest posts so only the process we started can write to this run. */
  token: string;
  proc: ChildProcess | null;
  /** Latest JPEG from the fixture, served at /api/runs/:id/live.jpg. */
  frame: Buffer | null;
  /** Set when the user presses stop, so the exit isn't reported as an error. */
  stopped: boolean;
  /** The reporter's `run:end` arrived; the process exit is then a normal finish. */
  reporterFinished: boolean;
  /** Last lines of process output, shown when Playwright dies before reporting anything. */
  outputTail: string[];
  /** Spellings of the service's secrets to mask in everything from the test process. */
  redactions: string[];
}

const runs = new Map<string, LiveRun>();

/** How long a finished run stays addressable, so a late ingest post doesn't 404. */
const LINGER_MS = 30_000;

export const addLive = (run: LiveRun): void => void runs.set(run.summary.id, run);
export const getLive = (id: string): LiveRun | undefined => runs.get(id);

/** Drop a finished run from memory after a short grace period. */
export function retire(id: string): void {
  setTimeout(() => runs.delete(id), LINGER_MS).unref();
}

export const isActive = (s: RunSummary): boolean => s.status === 'running' || s.status === 'starting';

export const activeSummary = (serviceId?: string): RunSummary | undefined =>
  [...runs.values()].map((r) => r.summary).find((s) => isActive(s) && (!serviceId || s.serviceId === serviceId));
