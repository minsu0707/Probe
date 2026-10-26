import { markdownToHtml } from './markdown.ts';

/** Renders Markdown through the escaping converter in markdown.ts (safe for untrusted text). */
export function Markdown({ source }: { source: string }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: markdownToHtml(source) }} />;
}
