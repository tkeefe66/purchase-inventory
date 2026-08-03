import { lookup } from 'node:dns/promises';

export function isPrivateAddress(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  return false;
}

export async function assertPublicHttpUrl(
  url: string,
): Promise<{ ok: true } | { ok: false; error: 'bad_scheme' | 'private_host' }> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, error: 'bad_scheme' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: 'bad_scheme' };
  if (parsed.hostname.endsWith('.railway.internal') || parsed.hostname === 'localhost')
    return { ok: false, error: 'private_host' };
  try {
    const { address } = await lookup(parsed.hostname);
    if (isPrivateAddress(address)) return { ok: false, error: 'private_host' };
  } catch {
    return { ok: false, error: 'private_host' };
  }
  return { ok: true };
}
