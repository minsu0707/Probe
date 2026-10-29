/**
 * What Probe checks when a turn that wrote specs ends. Claude's own report is not trusted for two
 * things: that the specs were run, and that nothing was skipped. When either is missing Probe sends
 * one follow-up turn itself instead of leaving the owner to notice. Pure, so it is easy to test.
 */

export interface SkipFound {
  file: string;
  line: number;
  text: string;
}

/** A line that disables a test or leaves a placeholder (`test.skip(`, `test.fixme(`, `.skip(` in a describe, TODO). */
const SKIP_LINE = /\b(?:test|it|describe)\.(?:skip|fixme)\s*\(|\/\/\s*(?:TODO|FIXME)\b/;

/** Skips in the specs written or changed this turn, in file order. */
export function findSkips(after: ReadonlyMap<string, string>, before: ReadonlyMap<string, string>): SkipFound[] {
  const found: SkipFound[] = [];
  for (const [file, text] of [...after].sort(([a], [b]) => a.localeCompare(b))) {
    if (before.get(file) === text) continue; // untouched this turn
    text.split('\n').forEach((line, i) => {
      if (SKIP_LINE.test(line)) found.push({ file, line: i + 1, text: line.trim().slice(0, 160) });
    });
  }
  return found;
}

/** Whether any spec file was added or changed. */
export const specsChanged = (after: ReadonlyMap<string, string>, before: ReadonlyMap<string, string>): boolean =>
  [...after].some(([file, text]) => before.get(file) !== text);

const MAX_LISTED = 15;

/** The follow-up message, or null when the turn needs none. */
export function followUpFor(o: { skips: SkipFound[]; ranTests: boolean }): string | null {
  const parts: string[] = [];
  if (o.skips.length) {
    const list = o.skips.slice(0, MAX_LISTED).map((s) => `- ${s.file}:${s.line}  ${s.text}`).join('\n');
    const more = o.skips.length > MAX_LISTED ? `\n- … and ${o.skips.length - MAX_LISTED} more` : '';
    parts.push(
      `Probe found skipped or unfinished tests in the specs you just wrote:\n${list}${more}\n` +
        'A skip is the last resort. For each one go through the steps in "Skipping is the last resort" (look harder in ./docs and ./knowledge, make the input yourself, read it from the screen, reach the state another way, wait for the right thing), then write the real step. ' +
        'Keep a skip only when none of them can supply a required value, and then say exactly what is missing and where you looked.',
    );
  }
  if (!o.ranTests) {
    parts.push(
      'You wrote or changed specs but did not run them. Run them now with run_tests (pass the spec file), read each failure and decide whether the test or the app is wrong, fix the tests that are wrong, and run again. Repeat until every failure left is a real app defect or something only the owner can answer, at most 3 rounds. Do not hand the run back to the owner.',
    );
  }
  if (!parts.length) return null;
  return `${parts.join('\n\n')}\n\nReply in Korean with the final result: what passed, what failed and why, and anything you still could not cover.`;
}
