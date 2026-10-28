/** Which environment variables are credentials. Pure, so the rule is easy to test and tune. */

/**
 * Names containing any of these are treated as sensitive: never displayed, never sent to
 * Claude, and scrubbed from logs. Deliberately broad; a harmless variable hidden by
 * mistake costs nothing, a leaked token does.
 */
const SENSITIVE_NAME = /(pass|pwd|pswd|secret|token|key|cookie|credential|private|auth|session|cert)|(^|[^a-z])pw($|[^a-z])/i;

export const isSensitiveKey = (key: string): boolean => SENSITIVE_NAME.test(key);

/** Env keys that can supply a service's URL when it has none. First match wins. */
export const BASE_URL_KEYS = ['BASE_URL', 'PROBE_BASE_URL', 'APP_URL', 'SITE_URL'] as const;

/** Values shorter than this are not scrubbed from logs: "1234" would mangle unrelated text. */
export const MIN_REDACTABLE_LENGTH = 4;
