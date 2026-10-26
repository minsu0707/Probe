/**
 * Keeping credentials out of logs. Test code echoes what it types (`Fill "hunter2"`), so
 * every string that came from the test process is scrubbed before it is stored, shown or
 * turned into a defect.
 */

/** Text that replaces a secret. Four dots, so it is visibly a mask and not a real value. */
export const MASK = '••••';

/**
 * Every spelling of every secret we must catch: the raw value and its JSON-escaped form.
 * Events are scrubbed after `JSON.stringify`, where a value containing a quote or
 * backslash no longer matches its raw spelling.
 * Longest first, so a secret that contains another secret is masked whole.
 */
export function redactionForms(secretValues: string[]): string[] {
  const forms = new Set<string>();
  for (const v of secretValues) {
    forms.add(v);
    forms.add(JSON.stringify(v).slice(1, -1));
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

export const scrub = (text: string, forms: string[]): string => forms.reduce((t, form) => t.split(form).join(MASK), text);

/** Scrub every string inside a JSON-serializable value without having to know its shape. */
export function scrubDeep<T>(value: T, forms: string[]): T {
  return forms.length === 0 ? value : (JSON.parse(scrub(JSON.stringify(value), forms)) as T);
}
