import { parseCookie, verifySessionToken, COOKIE_NAME } from "../_utils/session.js";
import { resolveResourceKey } from "../_utils/resources.js";
import { checkPaidConverted } from "../_utils/paid-check.js";
import { getPresignedUrl } from "../_utils/s3.js";

const LINK_LIFETIME_SECONDS = 300; // 5 minutes

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const slug = params.resource;

  // The site-wide middleware (functions/_middleware.js) already requires a
  // valid session for any path not explicitly public — this route isn't
  // public, so an unauthenticated visitor never reaches here. This check
  // is a defensive backstop, not the primary gate.
  const cookieHeader = request.headers.get("Cookie");
  const token = parseCookie(cookieHeader, COOKIE_NAME);
  const session = token ? await verifySessionToken(token, env.SESSION_SECRET) : null;

  if (!session) {
    const redirectUrl = new URL("/login.html", new URL(request.url).origin);
    redirectUrl.searchParams.set("next", new URL(request.url).pathname);
    return Response.redirect(redirectUrl.toString(), 302);
  }

  const objectKey = resolveResourceKey(slug);
  if (!objectKey) {
    return htmlResponse(
      "Resource not found",
      "We couldn't find that download. Double-check the link, or reply to the email it came from.",
      404
    );
  }

  // STRICT paying-only check — always hits Beehiiv live, never trusts the
  // session cookie for paid status (see _utils/paid-check.js).
  const result = await checkPaidConverted(session.email, env);

  if (!result.authorized) {
    return htmlResponse(
      "Not available yet",
      result.reason || "That email isn't authorized for this download.",
      403
    );
  }

  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY || !env.AWS_REGION || !env.AWS_PAID_BUCKET) {
    return htmlResponse(
      "Server isn't configured yet",
      "The download system is missing its AWS configuration. (Missing one or more of AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION / AWS_PAID_BUCKET in the Cloudflare Pages environment variables.)",
      500
    );
  }

  const signedUrl = await getPresignedUrl({
    bucket: env.AWS_PAID_BUCKET,
    key: objectKey,
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    expiresInSeconds: LINK_LIFETIME_SECONDS,
  });

  return Response.redirect(signedUrl, 302);
}

function htmlResponse(title, message, status) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body {
    background: #0E1520;
    color: #ECEAE0;
    font-family: Georgia, 'Times New Roman', serif;
    min-height: 100vh;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #1B2635;
    border: 1px solid rgba(212, 175, 90, 0.3);
    border-radius: 4px;
    padding: 40px;
    max-width: 460px;
  }
  h1 { font-size: 22px; margin: 0 0 14px; color: #ECEAE0; }
  p { font-size: 15px; line-height: 1.55; color: #A9B3C2; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
