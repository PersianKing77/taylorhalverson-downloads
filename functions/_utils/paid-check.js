// The site-wide login (functions/api/login.js) only checks "is this an
// active Teacher's Circle subscriber" — that's intentionally loose, because
// it also gates the 10 free interactive tools and trial members should get
// those. Paid PDF downloads need a STRICTER check: genuinely converted to
// paying, not just on the 30-day free trial. That distinction lives in the
// `tc-paid-converted` subscriber tag, which the existing 90-day tenure
// automation applies only once someone is confirmed paying (see
// [[renewal-checkin-automations]] / the tenure automation for how the tag
// gets set — this file only reads it).
//
// This check always hits Beehiiv live — it does NOT trust the session
// cookie for paid status, because the cookie only proves "was an active
// subscriber at some point in the last 30 days," not "is paying today."

const PAID_TAG = "tc-paid-converted";
const ACTIVE_STATUSES = ["active", "validating"];

/**
 * @param {string} email
 * @param {Object} env - Cloudflare Pages environment (needs BEEHIIV_API_KEY, BEEHIIV_PUBLICATION_ID)
 * @returns {Promise<{ authorized: boolean, reason?: string, debug?: any }>}
 */
export async function checkPaidConverted(email, env) {
  const debug = env.DEBUG_DOWNLOAD === "true";

  if (!env.BEEHIIV_API_KEY || !env.BEEHIIV_PUBLICATION_ID) {
    return { authorized: false, reason: "Server isn't configured yet (missing Beehiiv credentials)." };
  }

  const url =
    `https://api.beehiiv.com/v2/publications/${env.BEEHIIV_PUBLICATION_ID}` +
    `/subscriptions/by_email/${encodeURIComponent(email)}` +
    `?expand[]=subscription_premium_tiers&expand[]=tags`;

  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${env.BEEHIIV_API_KEY}` } });
  } catch (err) {
    return { authorized: false, reason: "Couldn't reach the subscriber system. Try again in a moment." };
  }

  if (res.status === 404) {
    return { authorized: false, reason: "We don't see that email as a subscriber." };
  }

  if (!res.ok) {
    return { authorized: false, reason: "Couldn't verify your subscription right now. Try again shortly." };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { authorized: false, reason: "Got an unexpected response from the subscriber system." };
  }

  const subscription = data.data || data;
  const status = (subscription.status || "").toLowerCase();
  const isActive = ACTIVE_STATUSES.includes(status);

  // Beehiiv's exact tag field shape isn't 100% confirmed from the outside —
  // check every shape it's known to return so this doesn't silently break
  // if the API returns tags differently than expected. Turn on
  // DEBUG_DOWNLOAD="true" in Cloudflare Pages env vars to see the raw
  // response and confirm before relying on this silently, same pattern as
  // DEBUG_LOGIN in api/login.js.
  const rawTags =
    subscription.tags ||
    subscription.subscription_tags ||
    (subscription.subscriptions || []).flatMap((s) => s.tags || []) ||
    [];
  const tagNames = rawTags.map((t) => (typeof t === "string" ? t : t && t.name) || "").map((t) => t.toLowerCase());
  const hasPaidTag = tagNames.includes(PAID_TAG);

  const authorized = isActive && hasPaidTag;

  if (debug) {
    return {
      authorized,
      debug: { status, tagNames, hasPaidTag, rawKeys: Object.keys(subscription) },
    };
  }

  if (!authorized) {
    return {
      authorized: false,
      reason: "That email isn't showing as a converted, paying Teacher's Circle member yet. If you're on the 30-day free trial, this unlocks once your trial converts to a paid subscription.",
    };
  }

  return { authorized: true };
}
