// Hand-written AWS SigV4 presigned-URL generator for S3 GetObject.
// Uses native Web Crypto only — no aws-sdk / npm dependency — to match this
// repo's no-build style (same reason session.js hand-rolls its own signing).
//
// Only implements what we need: a presigned GET URL, query-string style
// (the "curl-able link" style, not header-based signing), good for a set
// number of seconds.

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(message) {
  const data = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return toHex(hashBuffer);
}

async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function getSignatureKey(secretAccessKey, dateStamp, region, service) {
  const kDate = await hmac(new TextEncoder().encode("AWS4" + secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  return kSigning;
}

// RFC 3986 encoding — encodeURIComponent misses a few characters AWS cares about.
function rfc3986Encode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Generate a presigned S3 GET URL good for `expiresInSeconds`.
 *
 * @param {Object} opts
 * @param {string} opts.bucket - S3 bucket name
 * @param {string} opts.key - object key (path within the bucket), NOT url-encoded
 * @param {string} opts.region - e.g. "us-east-1"
 * @param {string} opts.accessKeyId
 * @param {string} opts.secretAccessKey
 * @param {number} [opts.expiresInSeconds=300] - link lifetime, max 604800 (7 days) per AWS
 * @returns {Promise<string>} the full presigned URL
 */
export async function getPresignedUrl({
  bucket,
  key,
  region,
  accessKeyId,
  secretAccessKey,
  expiresInSeconds = 300,
}) {
  const service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8); // YYYYMMDD

  const host = `${bucket}.s3.${region}.amazonaws.com`;
  // Encode each path segment but keep the slashes between them.
  const encodedKey = key.split("/").map(rfc3986Encode).join("/");
  const canonicalUri = `/${encodedKey}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  const queryParams = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };

  const sortedKeys = Object.keys(queryParams).sort();
  const canonicalQueryString = sortedKeys
    .map((k) => `${rfc3986Encode(k)}=${rfc3986Encode(queryParams[k])}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signatureBuffer = await hmac(signingKey, stringToSign);
  const signature = toHex(signatureBuffer);

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}
