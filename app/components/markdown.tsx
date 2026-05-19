import { marked } from 'marked';

interface Props {
  text: string;
}

/**
 * Render trusted markdown to HTML. Used only on authored (in-repo) content
 * like topic seeds — NOT for user input, so we don't sanitize. If a call
 * site ever needs to render user content, add DOMPurify here.
 *
 * We style tags via a parent `markdown-body` class instead of the Tailwind
 * typography plugin (not installed). Tokens match the rest of the dashboard.
 */
export function Markdown({ text }: Props) {
  marked.use({ gfm: true, breaks: false });
  const html = marked.parse(text, { async: false });
  return (
    <div
      className="markdown-body text-[13px] leading-relaxed text-text-secondary"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
