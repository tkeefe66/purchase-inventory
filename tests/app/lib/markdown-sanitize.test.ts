import { describe, it, expect } from 'vitest';
import DOMPurify from 'isomorphic-dompurify';

// Mirrors the component's transform; asserts the sanitizer strips active content.
function render(md: string): string {
  return DOMPurify.sanitize(md, { USE_PROFILES: { html: true } });
}

describe('markdown sanitization', () => {
  it('strips script tags and inline handlers', () => {
    const out = render('<img src=x onerror=alert(1)><script>alert(2)</script>ok');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('ok');
  });
  it('drops javascript: hrefs', () => {
    const out = render('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });
});
