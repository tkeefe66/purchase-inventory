import { describe, it, expect } from 'vitest';
import { tooLargeByContentLength } from '../../../app/lib/httpGuards.js';

describe('httpGuards', () => {
  it('flags oversized bodies by Content-Length', () => {
    const big = new Request('http://x', { method: 'POST', headers: { 'content-length': String(2_000_000) } });
    expect(tooLargeByContentLength(big, 1_000_000)).toBe(true);
  });
  it('allows bodies within the cap', () => {
    const ok = new Request('http://x', { method: 'POST', headers: { 'content-length': '500' } });
    expect(tooLargeByContentLength(ok, 1_000_000)).toBe(false);
  });
});
