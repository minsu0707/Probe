import type { ServiceOverview } from './api.ts';
import { toast } from './store.ts';

export const NO_TESTS_HINT = '실행할 테스트가 아직 없습니다. Claude 세션에서 테스트를 먼저 작성하세요.';

/** True when there is at least one written test to run. */
export const hasTests = (service: ServiceOverview): boolean => service.testCount > 0;

/** Props for a "run tests" button: looks disabled and explains itself on hover and on click, but stays clickable so the click can say why. */
export function runButtonProps(service: ServiceOverview, run: () => void | Promise<void>, busyHint?: string) {
  const blocked = !hasTests(service);
  return {
    'aria-disabled': blocked || undefined,
    title: blocked ? NO_TESTS_HINT : busyHint,
    onClick: () => (blocked ? toast(NO_TESTS_HINT, 'error') : void run()),
  };
}
