/**
 * Turning a raw test failure into something a person can triage. All pure functions:
 * given the same failure they return the same answer, which is what makes deduplication
 * across runs possible.
 */
import { createHash } from 'node:crypto';
import type { DefectCause, Severity } from '../../../shared/models.ts';

/** Playwright colours its error text; strip the escape codes before storing or hashing. */
export const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '');

/**
 * First-guess severity from the error text. The user can change it, so this only has to be
 * a sensible default:
 *   critical  the app itself broke (network failure, 5xx, uncaught exception)
 *   minor     a presentation-only assertion (screenshot, CSS, class)
 *   major     everything else, including ordinary wrong-value assertions
 *
 * The 5xx pattern requires the word "status": a bare `\b5\d\d\b` once matched the "500"
 * in a price like "3,500원" and mislabelled a text mismatch as critical.
 */
export function guessSeverity(error: string): Severity {
  if (/net::ERR_|status(?: code)?:?\s*5\d\d|TypeError|ReferenceError|Uncaught|crash/i.test(error)) return 'critical';
  if (/toHaveScreenshot|toHaveCSS|toHaveClass/.test(error)) return 'minor';
  return 'major';
}

/**
 * A first guess at who is wrong, from the error text alone. Only a hint for the person triaging:
 *   env      the browser or network failed, or Probe blocked a write on a read-only service
 *   test     the test itself is the likely culprit: an ambiguous or missing locator, a wait that ran out
 *   app      the page answered, but with something other than the expected value (Expected ... Received)
 */
export function guessCause(error: string): DefectCause {
  if (/blockedbyclient|net::ERR_|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ERR_NAME_NOT_RESOLVED|browser has been closed|Target (?:page|closed)|status(?: code)?:?\s*50[234]/i.test(error)) return 'env';
  if (/strict mode violation|element\(s\) not found|Test timeout of|is not a function|SyntaxError|Cannot find (?:module|name)|is not defined/i.test(error)) return 'test';
  if (/Received/.test(error)) return 'app';
  return 'unknown';
}

/**
 * Reduce the error's first line to its "shape" by masking numbers and hex addresses, so
 * "timeout 5000ms" and "timeout 5001ms" count as the same failure.
 */
export const errorShape = (error: string): string => error.split('\n')[0].replace(/\d+(\.\d+)?/g, 'N').replace(/0x[0-9a-f]+/gi, 'X');

/** Stable id for "the same failure": same service, same test, same kind of error. */
export function failureFingerprint(serviceId: string, testTitle: string[], error: string): string {
  return createHash('sha1').update(`${serviceId}|${testTitle.join('>')}|${errorShape(error)}`).digest('hex').slice(0, 16);
}

/** Fingerprint for defects Claude files by hand: identified by title alone. */
export const manualFingerprint = (serviceId: string, title: string): string => createHash('sha1').update(`${serviceId}|manual|${title}`).digest('hex').slice(0, 16);
