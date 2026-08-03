/** Neutralize Google Sheets / CSV formula injection in user-supplied text.
 *  With valueInputOption USER_ENTERED, a leading = + - @ is parsed as a live
 *  formula. Prefixing a single quote forces Sheets to store it as literal text. */
export function neutralizeFormula(value: string): string {
  if (/^\s*[=+\-@]/.test(value)) return `'${value}`;
  return value;
}
