/** Short random id. Works in insecure contexts too (crypto.randomUUID needs HTTPS). */
export function uid(prefix = ''): string {
  const bytes = new Uint8Array(9);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (const b of bytes) s += b.toString(36).padStart(2, '0');
  return prefix ? `${prefix}-${s}` : s;
}
