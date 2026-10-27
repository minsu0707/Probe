/**
 * The rule behind a "조회 전용" (read-only) service: which browser requests may leave the test
 * browser. Reads always pass. Writes are refused, except what a login needs and GraphQL queries
 * (which are POSTs that do not change anything), so a read-only test can still sign in and look.
 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SIGN_IN_PATH = /(^|[/_-])(log-?in|sign-?in|log-?out|sign-?out|auth|oauth2?|token|sso|saml)([/_.?-]|$)/i;

export function allowRequest(method: string, url: string, body?: string | null): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  if (SIGN_IN_PATH.test(path)) return true;
  if (body && /"query"\s*:/.test(body) && !/\bmutation\b/i.test(body)) return true;
  return false;
}
