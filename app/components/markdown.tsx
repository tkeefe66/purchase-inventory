import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

interface Props {
  text: string;
}

/** Render markdown to sanitized HTML. Safe for LLM- and user-influenced
 *  content: marked → DOMPurify strips scripts, event handlers, and
 *  javascript: URLs before it reaches dangerouslySetInnerHTML. */
export function Markdown({ text }: Props) {
  marked.use({ gfm: true, breaks: false });
  const raw = marked.parse(text, { async: false });
  const html = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  return (
    <div
      className="markdown-body text-[13px] leading-relaxed text-text-secondary"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
