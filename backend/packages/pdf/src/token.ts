async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '');
}

export async function signPreviewToken(secret: string, type: string, slug: string, ttlSec: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = await hmac(secret, `${type}:${slug}:${exp}`);
  return `${exp}.${sig}`;
}

export async function verifyPreviewToken(secret: string, type: string, slug: string, token: string): Promise<boolean> {
  const [expStr, sig] = (token ?? '').split('.');
  const exp = Number(expStr);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(secret, `${type}:${slug}:${exp}`);
  return sig === expected;
}
