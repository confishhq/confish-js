/**
 * Webhook signature verification for confish.
 *
 * Use the raw, unparsed request body — re-serializing parsed JSON will alter byte order
 * and break verification. This module uses Web Crypto and works in Node 18+, Bun, Deno,
 * and edge runtimes (Cloudflare Workers, Vercel Edge).
 */

export interface VerifyWebhookOptions {
  /** Raw request body as a string. */
  body: string;
  /** The X-Confish-Signature header value (e.g. `ts=1700000000;sig=abc...`). */
  signature: string | null | undefined;
  /** The webhook signing secret from the environment settings page. */
  secret: string;
  /**
   * Reject signatures with timestamps older than this many seconds, to prevent replay attacks.
   * Default: 300 (5 minutes). Pass 0 to disable.
   */
  toleranceSeconds?: number;
  /** Override the current time (seconds since epoch) — useful for testing. */
  now?: () => number;
}

export interface WebhookPayload {
  event: 'environment.updated' | 'environment.deleted' | string;
  timestamp: string;
  application: { name: string };
  environment: { name: string; env_id: string; url: string };
  changes?: string[];
  values?: Record<string, unknown>;
}

const SIGNATURE_RE = /^ts=(\d+);sig=([a-f0-9]+)$/i;

/**
 * Verify an incoming webhook signature. Returns true if the signature is valid AND
 * within the tolerance window, false otherwise. Uses constant-time comparison.
 */
export async function verifyWebhook(options: VerifyWebhookOptions): Promise<boolean> {
  if (!options.signature) return false;

  const match = SIGNATURE_RE.exec(options.signature.trim());
  if (!match) return false;

  const [, tsStr, providedSig] = match;
  const ts = Number.parseInt(tsStr!, 10);
  if (!Number.isFinite(ts)) return false;

  const tolerance = options.toleranceSeconds ?? 300;
  if (tolerance > 0) {
    const now = options.now ? options.now() : Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > tolerance) return false;
  }

  const expected = await hmacSha256Hex(options.secret, `${ts}:${options.body}`);
  return constantTimeEqual(providedSig!, expected);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
