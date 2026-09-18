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
// Setup required (see SETUP.md):
//   1. Create the D1 database and run schema.sql + migrations/001 + 002 against it.
//   2. In this Pages project's Settings -> Bindings -> D1 database bindings,
//      add a binding named ANALYTICS_DB pointing at that database.
// Until that binding exists, this file silently does nothing (downloads keep
// working exactly as today) -- it never breaks a real download if D1 isn't set up.

import { COOKIE_NAME, verifySessionToken } from "./_utils/session.js";

const SKIP_EXTENSIONS = /\.(css|js|mjs|json|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|txt|xml|webmanifest)$/i;

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

export async function onRequest(context) {
  const { request, next, env, waitUntil } = context;
  const response = await next();

  try {
    const url = new URL(request.url);

    if (env.ANALYTICS_DB) {
      const downloadMatch = url.pathname.match(/^\/download\/([^/?]+)/);

      if (downloadMatch) {
        // Every hit on the download route: 200 = signed URL actually issued,
        // anything else (401/403/404/etc.) = denied or not found. Both are
        // worth counting so you can see attempts vs. actual downloads, and
        // now who each attempt belongs to.
        const resource = decodeURIComponent(downloadMatch[1]);
        const email = await getEmailFromRequest(request, env);
        const row = {
          ts: new Date().toISOString(),
          resource,
          status: response.status,
          email,
          country: (request.cf && request.cf.country) || null,
          referrer: request.headers.get("referer") || null,
        };

        const insert = env.ANALYTICS_DB.prepare(
          `INSERT INTO downloads_log (ts, resource, status, email, country, referrer)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(row.ts, row.resource, row.status, row.email, row.country, row.referrer);

        waitUntil(insert.run().catch(() => {}));
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
