/**
 * Current usage of the Claude plan, asked from Anthropic's usage service with the login Claude Code
 * already holds, the same figures the CLI's own usage screen shows. Used by the refresh button in
 * the status bar; without it the numbers are only as fresh as the last background job.
 *
 * The access token is read from Claude Code's credentials file, sent to api.anthropic.com only, and
 * never stored, logged or returned. The service is not a published API: any failure here
 * (no file, expired login, changed format) is reported as a short message and nothing else changes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaudeUsage, UsageWindow } from '../../../shared/models.ts';
import { HOME } from '../../config.ts';
import type { ClaudeProfile } from '../../../shared/models.ts';

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const TIMEOUT_MS = 10_000;

/** Where Claude Code keeps its login for this profile. */
export const credentialsPath = (profile: ClaudeProfile, env: NodeJS.ProcessEnv = process.env): string =>
  join(profile === 'probe' ? join(HOME, 'claude') : (env.CLAUDE_CONFIG_DIR ?? join(env.USERPROFILE ?? env.HOME ?? '', '.claude')), '.credentials.json');

/** `{ five_hour: { utilization: 5, resets_at: ISO }, seven_day: … }`, utilization in percent. Anything else is null. */
export function parseOauthUsage(json: unknown, now = Date.now()): ClaudeUsage | null {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, any>;
  const win = (w: any): UsageWindow | null => {
    const resetsAt = typeof w?.resets_at === 'string' ? Date.parse(w.resets_at) : NaN;
    return typeof w?.utilization === 'number' && Number.isFinite(resetsAt) ? { utilization: Math.min(1, Math.max(0, w.utilization / 100)), resetsAt } : null;
  };
  const fiveHour = win(j.five_hour);
  const sevenDay = win(j.seven_day);
  return fiveHour || sevenDay ? { fiveHour, sevenDay, at: now } : null;
}

export async function fetchLiveUsage(profile: ClaudeProfile): Promise<ClaudeUsage> {
  let token: string | undefined;
  try {
    token = JSON.parse(readFileSync(credentialsPath(profile), 'utf8'))?.claudeAiOauth?.accessToken;
  } catch {
    /* handled below */
  }
  if (!token) throw new Error('Claude 로그인 정보를 읽지 못했습니다. 설정에서 로그인 상태를 확인하세요.');

  let res: Response;
  try {
    res = await fetch(ENDPOINT, { headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error('사용량 서버에 연결하지 못했습니다.');
  }
  if (res.status === 401 || res.status === 403) throw new Error('로그인이 만료되었습니다. Claude Code를 한 번 실행하거나 다시 로그인하세요.');
  if (res.status === 429) throw new Error('잠시 후 다시 시도하세요 (요청이 너무 많습니다).');
  if (!res.ok) throw new Error(`사용량을 가져오지 못했습니다 (HTTP ${res.status}).`);
  const usage = parseOauthUsage(await res.json().catch(() => null));
  if (!usage) throw new Error('사용량 응답 형식을 알 수 없습니다.');
  return usage;
}
