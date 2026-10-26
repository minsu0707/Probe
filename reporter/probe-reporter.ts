import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import type { TestStatus } from '../server/types.ts';
import { send } from './transport.ts';

const REPORTED_STEPS = new Set(['test.step', 'pw:api', 'expect']);

export default class ProbeReporter implements Reporter {
  onBegin(_config: FullConfig, suite: Suite) {
    void send([{ type: 'run:plan', total: suite.allTests().length }]);
  }

  onTestBegin(test: TestCase) {
    // titlePath() is ['', project, file, ...describes, title]; the dashboard wants the last part.
    void send([{ type: 'test:begin', id: test.id, title: test.titlePath().slice(3), file: test.location.file, project: test.parent.project()?.name ?? '' }]);
  }

  onStepBegin(test: TestCase, _result: TestResult, step: TestStep) {
    if (!REPORTED_STEPS.has(step.category)) return;
    // Only top-level steps, or direct children of a test.step, so one click is one line.
    if (step.parent && step.parent.category !== 'test.step') return;
    void send([{ type: 'step', id: test.id, title: step.title }]);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const failed = result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted';
    // A failed attempt that will be retried is not a result yet.
    if (failed && result.retry < test.retries) return;
    const attach = (name: string) => result.attachments.find((a) => a.name === name)?.path;
    void send([
      {
        type: 'test:end',
        id: test.id,
        status: result.status as TestStatus,
        durationMs: result.duration,
        retry: result.retry,
        error: result.error?.message,
        errorStack: result.error?.stack,
        screenshot: attach('screenshot'),
        trace: attach('trace'),
      },
    ]);
  }

  async onEnd(result: FullResult) {
    const status = result.status === 'passed' ? 'passed' : result.status === 'timedout' ? 'timedOut' : result.status === 'interrupted' ? 'interrupted' : 'failed';
    await send([{ type: 'run:end', status }]);
  }

  printsToStdio() {
    return false;
  }
}
