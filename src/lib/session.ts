const encoder = new TextEncoder();

export const SESSION_COOKIE = "drillup_session";
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90일

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(
  secret: string,
  now: number = Date.now(),
): Promise<string> {
  const expiresAt = now + SESSION_TTL_MS;
  return `${expiresAt}.${await hmacHex(secret, String(expiresAt))}`;
}

export async function verifySessionToken(
  secret: string,
  token: string,
  now: number = Date.now(),
): Promise<boolean> {
  const [expStr, sig] = token.split(".");
  if (!expStr || !sig) return false;
  const expiresAt = Number(expStr);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  return (await hmacHex(secret, expStr)) === sig;
}
