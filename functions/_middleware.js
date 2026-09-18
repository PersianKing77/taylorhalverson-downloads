// Analytics logging for downloads.taylorhalverson.com
//
// This file is ADDITIVE ONLY. It does not touch your existing /download/:resource
// route, the S3 signed-URL logic, or the Beehiiv paid-tag check. It watches the
// response that route already produces and logs one row per attempt, then lets
// the response go out exactly as before.
//
// UPDATED: now also records WHO downloaded (session.email) by reading and
// verifying the same session cookie your real download route already reads --
// using the same COOKIE_NAME / verifySessionToken helpers from
// functions/_utils/session.js. This middleware only ever READS that cookie;
// it never writes to it, never changes the paywall check, and never touches
// functions/download/[resource].js. If reading the session fails for any
// reason, the download row is still logged, just with email = null -- it
// never blocks or breaks a real download.
//
// UPDATED AGAIN: also tags each download with the person's Beehiiv
// subscription tier (Teacher's Circle / Insights Plus / Free newsletter /
// Not subscribed) by calling the Beehiiv API. That lookup runs entirely in
// the background AFTER the download response has already gone out to the
// browser (via waitUntil) -- it can never slow down or block a real
// download, even if the Beehiiv API is slow or down.
//
// Setup required (see SETUP.md):
//   1. Create the D1 database and run schema.sql + migrations/001, 002, 003 against it.
//   2. In this Pages project's Settings -> Bindings -> D1 database bindings,
//      add a binding named ANALYTICS_DB pointing at that database.
//   3. In this Pages project's Settings -> Variables and secrets, add a
//      secret named BEEHIIV_API_KEY (the same key value already used by
//      your insights-analytics Worker). Without it, tier lookups are
//      silently skipped and downloads keep working exactly as before.
// Until the D1 binding exists, this file silently does nothing (downloads keep
// working exactly as today) -- it never breaks a real download if D1 isn't set up.

import { COOKIE_NAME, verifySessionToken } from "./_utils/session.js";

const SKIP_EXTENSIONS = /\.(css|js|mjs|json|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|txt|xml|webmanifest)$/i;

// Taylor Halverson Insights publication ID. Read from the env secret
// (BEEHIIV_PUBLICATION_ID) so this always matches whatever's actually
// configured in Cloudflare rather than a value hardcoded here. Falls back
// to the known publication ID if the secret isn't set, so tier lookups
// keep working even before/without that secret being added.
const FALLBACK_PUBLICATION_ID = "pub_366ec352-2d09-4fd4-91eb-6e5f94c35782";

async function getEmailFromRequest(request, env) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    if (!COOKIE_NAME) return null;
    const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
    if (!match) return null;
    const token = decodeURIComponent(match[1]);
    const session = await verifySessionToken(token, env.SESSION_SECRET);
    return (session && session.email) || null;
  } catch (err) {
    return null;
  }
}

// Looks up a subscriber's current Beehiiv tier by email. Returns one of:
// "Teacher's Circle", "Insights Plus", "Free newsletter", "Not subscribed",
// or null (lookup unavailable/failed -- never thrown, never blocks logging).
async function lookupBeehiivTier(email, env) {
  if (!email || !env.BEEHIIV_API_KEY) return null;
  try {
    const publicationId = env.BEEHIIV_PUBLICATION_ID || FALLBACK_PUBLICATION_ID;
    const url = `https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.BEEHIIV_API_KEY}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const sub = json && json.data && json.data[0];
    if (!sub) return "Not subscribed";
    // Confirmed directly against the live Beehiiv API for this publication:
    // tier names can come back as a `tiers` array of {id, name} objects
    // (not just the flat `subscription_premium_tier_names` string array this
    // originally assumed), and the name itself uses a curly apostrophe
    // ("Teacher’s Circle") rather than a straight one. Either mismatch
    // alone silently drops a real Teacher's Circle subscriber to "Free
    // newsletter" -- read both possible shapes and normalize the apostrophe
    // before comparing.
    const rawNames = Array.isArray(sub.subscription_premium_tier_names)
      ? sub.subscription_premium_tier_names
      : Array.isArray(sub.tiers)
      ? sub.tiers.map((t) => (t && t.name) || "")
      : [];
    const tiers = rawNames.map((n) => String(n).replace(/[‘’]/g, "'"));
    if (tiers.includes("Teacher's Circle")) return "Teacher's Circle";
    if (tiers.includes("Insights Plus")) return "Insights Plus";
    return "Free newsletter";
  } catch (err) {
    return null;
  }
}

export async function onRequest(context) {
  const { request, next, env, waitUntil } = context;
  const response = await next();

  try {
    const url = new URL(request.url);

    if (env.ANALYTICS_DB) {
      const downloadMatch = url.pathname.match(/^\/download\/([^/?]+)/);

      if (downloadMatch) {
        // Every hit on the download route: 3xx (redirect to the signed S3
        // URL) = a real successful download, anything else (401/403/404/
        // etc.) = denied or not found. Both are worth counting so you can
        // see attempts vs. actual downloads, and now who each attempt
        // belongs to and what subscriber tier they're on.
        const resource = decodeURIComponent(downloadMatch[1]);
        let status = response.status;
        const country = (request.cf && request.cf.country) || null;
        const referrer = request.headers.get("referer") || null;
        const ts = new Date().toISOString();

        // [resource].js redirects with the SAME 3xx status for two very
        // different cases: "here's your signed download URL" (real success)
        // and "you're not logged in, go to /login.html" (not a download at
        // all). Both used to get counted as "successful" downstream since
        // the dashboard just checks 300<=status<400. Re-tag the login-bounce
        // case as 401 here -- before it's ever written to D1 -- so a real
        // download and an anonymous bounce are never conflated again. This
        // only changes what gets LOGGED; the actual redirect already sent to
        // the visitor's browser (captured in `response` above) is untouched.
        if (status >= 300 && status < 400) {
          const location = response.headers.get("location") || "";
          if (location.includes("/login.html")) {
            status = 401;
          }
        }

        // Everything in here -- reading the session cookie, calling the
        // Beehiiv API to look up the tier, and writing the D1 row -- runs
        // AFTER `response` has already been handed back below. waitUntil()
        // just keeps the Worker alive long enough to finish it in the
        // background; none of it can add even a millisecond to the actual
        // download response, and if the Beehiiv API is slow or down, the
        // row is still logged (with tier = null).
        waitUntil(
          (async () => {
            let email = null;
            let tier = null;
            try {
              email = await getEmailFromRequest(request, env);
            } catch (err) {
              email = null;
            }
            try {
              tier = await lookupBeehiivTier(email, env);
            } catch (err) {
              tier = null;
            }
            try {
              await env.ANALYTICS_DB.prepare(
                `INSERT INTO downloads_log (ts, resource, status, email, tier, country, referrer)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
              )
                .bind(ts, resource, status, email, tier, country, referrer)
                .run();
            } catch (err) {
              // Analytics must never surface an error.
            }
          })()
        );
      } else if (!SKIP_EXTENSIONS.test(url.pathname) && !url.pathname.startsWith("/_") &&
                 request.method === "GET" && response.status === 200) {
        // General page visits (the downloads list page, login page, etc.) --
        // logged into the same shared table the resources site uses, tagged
        // by site, so you can also see overall traffic to this domain.
        const row = {
          ts: new Date().toISOString(),
          site: "downloads",
          path: url.pathname,
          referrer: request.headers.get("referer") || null,
          country: (request.cf && request.cf.country) || null,
          user_agent: request.headers.get("user-agent") || null,
        };

        const insert = env.ANALYTICS_DB.prepare(
          `INSERT INTO resource_visits (ts, site, path, referrer, country, user_agent)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(row.ts, row.site, row.path, row.referrer, row.country, row.user_agent);

        waitUntil(insert.run().catch(() => {}));
      }
    }
  } catch (err) {
    // Analytics must never break a real download. Swallow any unexpected error.
  }

  return response;
}
