export function isAllowedEmail(
  email: string | null | undefined,
  allowlistCsv: string | undefined,
): boolean {
  if (!email || !allowlistCsv) return false;
  const allowed = allowlistCsv
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
