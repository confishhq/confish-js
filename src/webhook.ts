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

/** Base class for all webhook verification failures. */
export class WebhookVerificationError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'WebhookVerificationError';
  }
}

/** The signature header is missing, malformed, or does not match the body. */
export class WebhookSignatureError extends WebhookVerificationError {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/** The signature is valid but its timestamp is outside the tolerance window. */
export class WebhookTimestampError extends WebhookVerificationError {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookTimestampError';
  }
}

const SIGNATURE_RE = /^ts=(\d+);sig=([a-f0-9]+)$/i;

/**
 * Verify an incoming webhook and parse its body in one operation. Resolves with the
 * parsed payload when the signature is valid AND within the tolerance window; throws
 * a WebhookSignatureError or WebhookTimestampError otherwise. Uses constant-time
 * comparison.
 */
export async function verifyWebhook(options: VerifyWebhookOptions): Promise<WebhookPayload> {
  if (!options.signature) {
    throw new WebhookSignatureError('Missing signature header');
  }

  const match = SIGNATURE_RE.exec(options.signature.trim());
  if (!match) {
    throw new WebhookSignatureError('Malformed signature header');
  }

  const [, tsStr, providedSig] = match;
  const ts = Number.parseInt(tsStr!, 10);
  if (!Number.isFinite(ts)) {
    throw new WebhookSignatureError('Malformed signature timestamp');
  }

  const expected = await hmacSha256Hex(options.secret, `${ts}:${options.body}`);
  if (!constantTimeEqual(providedSig!, expected)) {
    throw new WebhookSignatureError('Signature does not match the body');
  }

  const tolerance = options.toleranceSeconds ?? 300;
  if (tolerance > 0) {
    const now = options.now ? options.now() : Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > tolerance) {
      throw new WebhookTimestampError(
        `Signature timestamp is outside the tolerance window of ${tolerance}s`,
      );
    }
  }

  try {
    return JSON.parse(options.body) as WebhookPayload;
  } catch (cause) {
    throw new WebhookVerificationError('Failed to parse webhook body as JSON', { cause });
  }
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
