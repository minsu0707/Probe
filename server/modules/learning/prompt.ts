/**
 * The instructions given to Claude for the learning job. Kept apart from the runner so the
 * wording can be reviewed and tuned without touching process-handling code.
 *
 * The prompt is in English because instructions follow more reliably that way; it tells
 * Claude to write the knowledge files in the language of the source documents and to give
 * the final summary in Korean, which is what the user reads.
 */

import { BACKGROUND_ALLOWED_TOOLS, BACKGROUND_DENIED_TOOLS } from '../agents/claude-cli.ts';

/** The knowledge files the prompt asks for, in the order the UI shows them. */
export const KNOWLEDGE_FILES = ['overview.md', 'screens.md', 'flows.md', 'rules.md', 'test-points.md', 'open-questions.md'] as const;

export interface PromptInput {
  serviceName: string;
  baseUrl: string | null;
  /** Drive links Claude must read with its Drive connector. */
  driveLinks: string[];
  /** True when ./knowledge already has files from an earlier run. */
  hasExistingKnowledge: boolean;
  /** Probe walked through the live service first; its notes are in ./explore. */
  hasExploration?: boolean;
}

export function buildLearnPrompt({ serviceName, baseUrl, driveLinks, hasExistingKnowledge, hasExploration }: PromptInput): string {
  const drive = driveLinks.length
    ? `- Google Drive links (read them with the Google Drive tools; if a link is a folder, read its readable contents):\n${driveLinks.map((l) => `  - ${l}`).join('\n')}`
    : '- No Google Drive links were added.';

  const existing = hasExistingKnowledge
    ? '- ./knowledge already holds an earlier version. Read it first, keep what is still supported by the sources, and update it. Do not drop information the user may have edited by hand unless a source contradicts it.\n'
    : '';

  const explored = hasExploration
    ? `- ./explore holds what Probe saw when it walked through the live service in a browser (read-only; nothing was saved or changed). Read ./explore/pages.md in full: one section per screen with its address, headings, menus, table columns, input fields and buttons. ./explore/shots/NNN.jpg are screenshots of those screens (the number is the section number); open the landing page and at least one screen per menu group with the Read tool. This shows what the service really does, so cite it as [탐색: <address>] and treat it as a source equal to the documents. pages.md has one part per account ("# 계정: ADMIN", "# 계정: RES1"…): every account that Probe has a login for was walked separately, because each role sees different menus. Compare the accounts: a menu or screen that one role has and another lacks is a permission fact, so write it into rules.md as a role-by-role permission table citing [탐색: <account> <address>], and note in screens.md which roles can open each screen. A part marked 로그인 실패 saw only the sign-in screen. Where the live service and a document disagree, record both in open-questions.md. Do not take the walk-through to be complete: list in open-questions.md every menu, tab or screen that documents or screenshots mention but pages.md has no section for, as "미확인 화면", so the owner knows which parts were never looked at, and never describe such a screen in screens.md as if it had been seen. The exploration saw only what each account's sign-in could reach and stopped at a per-account page limit, so say so in open-questions.md where it matters.\n`
    : '';
  return `You are building the domain knowledge base for QA test automation of the service "${serviceName}"${baseUrl ? ` (${baseUrl})` : ''}.

Source material:
- Local files are in ./docs. For any file that has a sibling "<name>.extracted.txt", read that text file instead of the original. Read every file; images and PDFs are readable with the Read tool. Use Glob to list them.
${drive}
${explored}${existing}
Write these files into ./knowledge (Markdown, in the language the source documents are written in):
- overview.md: what the service is, who uses it, user roles, glossary of domain terms.
- screens.md: menu and screen inventory. For each screen: purpose, main fields and actions, who can access it.
- flows.md: business processes as numbered steps, with preconditions and the expected result of each step. Where a document holds a start-to-finish walkthrough with concrete input values and expected results (a guide, a POC or acceptance scenario), write it as its own named scenario here, in order, keeping those input values and expected results verbatim with their source. These scenarios are replayed as end-to-end tests, so do not summarise the numbers away.
- rules.md: validation rules, permissions per role, calculations and formulas, status transitions, limits, and edge cases.
- test-points.md: prioritized test points (P0/P1/P2), each with the risk it covers, and a pointer to the screen or flow it belongs to.
- open-questions.md: contradictions between documents, gaps, and anything you could not determine.

Rules:
1. Every factual claim must name its source in brackets, for example [spec.pdf p.12] or [Drive: <title>]. Mark anything you inferred rather than read as (inferred). Never present an inference as a fact.
2. Do not invent screens, fields, rules or numbers. If the documents are silent, put the question in open-questions.md.
3. If two documents disagree, record both claims with their sources in open-questions.md and use the newer or more specific one only if the documents say which is newer.
4. Do not include credentials, tokens or personal data that appear in the documents.
5. You cannot open or test the live service yourself. This task is reading and writing files only.
6. Finish with a short summary written in Korean: what you read, what you wrote, and the three biggest gaps. If a document clearly belongs to a different service than "${serviceName}", say so first.`;
}

/** CLI arguments for `claude -p`. The tool lists are the agent-wide policy for background jobs. */
export function buildClaudeArgs(prompt: string): string[] {
  return [
    '-p',
    prompt,
    '--output-format',
    'stream-json', // one JSON event per line, so progress can be shown live
    '--verbose', // required by the CLI for stream-json in print mode
    '--no-session-persistence',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    ...BACKGROUND_ALLOWED_TOOLS,
    '--disallowedTools',
    ...BACKGROUND_DENIED_TOOLS,
  ];
}
