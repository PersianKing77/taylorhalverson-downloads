// Shared helpers for creating and verifying signed session cookies.
// No database required — the cookie itself carries the (signed) proof of access.

const COOKIE_NAME = "tc_session";
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

function base64UrlEncode(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

async function getKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// Creates a signed token of the form: base64url(payloadJSON).base64url(signature)
export async function createSessionToken(email, secret, ttlSeconds = THIRTY_DAYS_SECONDS) {
  const payload = { email, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadPart = base64UrlEncode(payloadBytes);

  const key = await getKey(secret);
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));
  const sigPart = base64UrlEncode(new Uint8Array(sigBuffer));

  return `${payloadPart}.${sigPart}`;
}

// Returns { email } if the token is valid and unexpired, otherwise null.
export async function verifySessionToken(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [payloadPart, sigPart] = token.split(".");
  if (!payloadPart || !sigPart) return null;

  try {
    const key = await getKey(secret);
    const expectedSigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));
    const expectedSigPart = base64UrlEncode(new Uint8Array(expectedSigBuffer));

    // Constant-time-ish comparison (fine at this scale — not defending a bank vault)
    if (expectedSigPart !== sigPart) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadPart));
    const payload = JSON.parse(payloadJson);

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.email) return null;

    return { email: payload.email };
  } catch (err) {
    return null;
  }
}

export function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function buildSetCookie(token, maxAgeSeconds = THIRTY_DAYS_SECONDS) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function buildClearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export { COOKIE_NAME };
