import { buildClearCookie } from "../_utils/session.js";

export async function onRequestGet(context) {
  const headers = new Headers();
  headers.append("Set-Cookie", buildClearCookie());
  headers.set("Location", "/login.html");
  return new Response(null, { status: 302, headers });
}
