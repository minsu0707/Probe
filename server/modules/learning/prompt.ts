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
}

export function buildLearnPrompt({ serviceName, baseUrl, driveLinks, hasExistingKnowledge }: PromptInput): string {
  const drive = driveLinks.length
    ? `- Google Drive links (read them with the Google Drive tools; if a link is a folder, read its readable contents):\n${driveLinks.map((l) => `  - ${l}`).join('\n')}`
    : '- No Google Drive links were added.';

  const existing = hasExistingKnowledge
    ? '- ./knowledge already holds an earlier version. Read it first, keep what is still supported by the sources, and update it. Do not drop information the user may have edited by hand unless a source contradicts it.\n'
    : '';

  return `You are building the domain knowledge base for QA test automation of the service "${serviceName}"${baseUrl ? ` (${baseUrl})` : ''}.

Source material:
- Local files are in ./docs. For any file that has a sibling "<name>.extracted.txt", read that text file instead of the original. Read every file; images and PDFs are readable with the Read tool. Use Glob to list them.
${drive}
${existing}
Write these files into ./knowledge (Markdown, in the language the source documents are written in):
- overview.md: what the service is, who uses it, user roles, glossary of domain terms.
- screens.md: menu and screen inventory. For each screen: purpose, main fields and actions, who can access it.
- flows.md: business processes as numbered steps, with preconditions and the expected result of each step.
- rules.md: validation rules, permissions per role, calculations and formulas, status transitions, limits, and edge cases.
- test-points.md: prioritized test points (P0/P1/P2), each with the risk it covers, and a pointer to the screen or flow it belongs to.
- open-questions.md: contradictions between documents, gaps, and anything you could not determine.

Rules:
1. Every factual claim must name its source in brackets, for example [spec.pdf p.12] or [Drive: <title>]. Mark anything you inferred rather than read as (inferred). Never present an inference as a fact.
2. Do not invent screens, fields, rules or numbers. If the documents are silent, put the question in open-questions.md.
3. If two documents disagree, record both claims with their sources in open-questions.md and use the newer or more specific one only if the documents say which is newer.
4. Do not include credentials, tokens or personal data that appear in the documents.
5. Do not open or test the live service. This task is reading and writing files only.
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
