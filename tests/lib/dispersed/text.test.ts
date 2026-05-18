import { describe, test, expect } from 'vitest';
import { stripHtml } from '../../../lib/dispersed/text.js';

describe('stripHtml', () => {
  test('removes paragraph and break tags', () => {
    expect(stripHtml('<p>Hello</p><p>World</p>')).toBe('Hello World');
    expect(stripHtml('Line 1<br>Line 2')).toBe('Line 1 Line 2');
  });

  test('decodes common named entities', () => {
    expect(stripHtml('Summer&rsquo;s quiet beauty')).toBe("Summer's quiet beauty");
    expect(stripHtml('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(stripHtml('site&nbsp;name')).toBe('site name');
    expect(stripHtml('&quot;quoted&quot;')).toBe('"quoted"');
  });

  test('decodes numeric entities', () => {
    expect(stripHtml('&#8212;dashes&#8212;')).toBe('—dashes—');
    expect(stripHtml('&#x2014;')).toBe('—');
  });

  test('drops img tags and script blocks', () => {
    expect(stripHtml('<p><img alt="x" src="y.jpg" />Hi</p>')).toBe('Hi');
    expect(stripHtml('<script>alert(1)</script>Hello')).toBe('Hello');
    expect(stripHtml('<style>p{color:red}</style>Hello')).toBe('Hello');
  });

  test('collapses whitespace', () => {
    expect(stripHtml('a  b   c\n\nd')).toBe('a b c d');
  });

  test('strips a realistic USFS description', () => {
    const html = '<p><img alt="lake" src="x.jpg" /></p><p>Trout Lakes contains 12&nbsp;primitive campsites and access roads.</p><p><strong>Safety Information</strong></p><p>Access road is extremely hazardous when wet.</p>';
    const out = stripHtml(html);
    expect(out).toBe('Trout Lakes contains 12 primitive campsites and access roads. Safety Information Access road is extremely hazardous when wet.');
  });

  test('empty input → empty output', () => {
    expect(stripHtml('')).toBe('');
    expect(stripHtml('   ')).toBe('');
  });

  test('plain text passes through unchanged (modulo whitespace)', () => {
    expect(stripHtml('Just plain text.')).toBe('Just plain text.');
  });
});
