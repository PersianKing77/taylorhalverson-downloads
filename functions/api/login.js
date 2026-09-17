import { createSessionToken, buildSetCookie } from "../_utils/session.js";

// Statuses Beehiiv uses that count as "actively receiving mail" — validated against
// your real API response before going live (see DEBUG mode note below).
const ACTIVE_STATUSES = ["active", "validating"];

export async function onRequestPost(context) {
  const { request, env } = context;
  const debug = env.DEBUG_LOGIN === "true";

  try {
    let email;
    try {
      const body = await request.json();
      email = (body.email || "").trim().toLowerCase();
    } catch (err) {
      return json({ ok: false, error: "Send a JSON body with an email field." }, 400);
    }

    if (!email || !email.includes("@")) {
      return json({ ok: false, error: "Enter a valid email address." }, 400);
    }

    if (!env.BEEHIIV_API_KEY || !env.BEEHIIV_PUBLICATION_ID) {
      return json({ ok: false, error: "Server isn't configured yet (missing Beehiiv credentials)." }, 500);
    }

    const tierNameNeeded = (env.TEACHERS_CIRCLE_TIER_NAME || "teacher's circle").toLowerCase();

    const beehiivUrl =
      `https://api.beehiiv.com/v2/publications/${env.BEEHIIV_PUBLICATION_ID}` +
      `/subscriptions/by_email/${encodeURIComponent(email)}?expand[]=subscription_premium_tiers`;

    let beehiivRes;
    try {
      beehiivRes = await fetch(beehiivUrl, {
        headers: { Authorization: `Bearer ${env.BEEHIIV_API_KEY}` },
      });
    } catch (err) {
      return json({ ok: false, error: "Couldn't reach the subscriber system. Try again in a moment.", debug: debug ? String(err) : undefined }, 502);
    }

    if (beehiivRes.status === 404) {
      return json({ ok: false, error: "We don't see that email as a subscriber. Double-check it, or use the address you signed up with." }, 403);
    }

    if (!beehiivRes.ok) {
      const bodyText = debug ? await beehiivRes.text().catch(() => "") : undefined;
      return json({
        ok: false,
        error: "Couldn't verify your subscription right now. Try again shortly.",
        debug: debug ? { httpStatus: beehiivRes.status, body: bodyText } : undefined,
      }, 502);
    }

    let beehiivData;
    try {
      beehiivData = await beehiivRes.json();
    } catch (err) {
      return json({ ok: false, error: "Got an unexpected response from the subscriber system.", debug: debug ? String(err) : undefined }, 502);
    }

    const subscription = beehiivData.data || beehiivData;

    const status = (subscription.status || "").toLowerCase();
    // Beehiiv returns this as a flat array of tier name strings, e.g. ["Teacher's Circle"] —
    // not an array of tier objects. Handle both shapes defensively.
    const rawTierNames = subscription.subscription_premium_tier_names
      || (subscription.subscription_premium_tiers || []).map((t) => (t && t.name) || t);
    const tierNames = (rawTierNames || []).map((n) => (n || "").toString().toLowerCase());
    const hasTeachersCircle = tierNames.some((name) => name.includes(tierNameNeeded));

    const isActiveSubscriber = ACTIVE_STATUSES.includes(status);
    const authorized = isActiveSubscriber && hasTeachersCircle;

    // DEBUG MODE — set env.DEBUG_LOGIN = "true" in Cloudflare Pages while you're first
    // wiring this up, so you can see exactly what Beehiiv sent back and confirm the
    // real tier name / status values before relying on it silently. Turn it off after.
    if (debug) {
      return json({
        ok: authorized,
        debug: { status, tierNames, tierNameNeeded, rawKeys: Object.keys(subscription), rawSubscription: subscription },
      });
    }

    if (!authorized) {
      return json({ ok: false, error: "That email isn't an active Teacher's Circle subscriber." }, 403);
    }

    const token = await createSessionToken(email, env.SESSION_SECRET);
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", buildSetCookie(token));

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (err) {
    // Catch-all so a bug here never shows up as a bare Cloudflare error page —
    // you always get readable JSON back, with the real error when DEBUG_LOGIN is on.
    return json({
      ok: false,
      error: "Something went wrong on our end.",
      debug: debug ? { message: String(err && err.message || err), stack: err && err.stack } : undefined,
    }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
