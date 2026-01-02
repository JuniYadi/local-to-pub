// packages/server/lib/subdomain.ts
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const SUBDOMAIN_LENGTH = 6;

export function generateSubdomain(): string {
  const bytes = new Uint8Array(SUBDOMAIN_LENGTH);
  crypto.getRandomValues(bytes);

  let result = "";
  for (let i = 0; i < SUBDOMAIN_LENGTH; i++) {
    result += CHARS[bytes[i] % CHARS.length];
  }
  return result;
}

export function isValidSubdomain(subdomain: string): boolean {
  if (subdomain.length < 3 || subdomain.length > 20) {
    return false;
  }
  return /^[a-z0-9]+$/.test(subdomain);
}

export function extractSubdomain(host: string, baseDomain: string): string | null {
  const suffix = `.${baseDomain}`;
  if (!host.endsWith(suffix)) {
    return null;
  }
  const subdomain = host.slice(0, -suffix.length);
  if (!isValidSubdomain(subdomain)) {
    return null;
  }
  return subdomain;
}
