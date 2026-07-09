import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  WebhookSignatureError,
  WebhookTimestampError,
  WebhookVerificationError,
  verifyWebhook,
} from '../src/webhook.js';

function sign(secret: string, ts: number, body: string): string {
  return createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
}

describe('verifyWebhook', () => {
  const secret = 'whsec_test';
  const body = '{"event":"environment.updated"}';

  it('returns the parsed payload for a valid signature', async () => {
    const ts = 1_700_000_000;
    const sig = sign(secret, ts, body);
    const payload = await verifyWebhook({
      body,
      signature: `ts=${ts};sig=${sig}`,
      secret,
      now: () => ts,
    });
    expect(payload.event).toBe('environment.updated');
  });

  it('throws WebhookSignatureError when the secret is wrong', async () => {
    const ts = 1_700_000_000;
    const sig = sign('different', ts, body);
    await expect(
      verifyWebhook({
        body,
        signature: `ts=${ts};sig=${sig}`,
        secret,
        now: () => ts,
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('throws WebhookSignatureError when the body is tampered', async () => {
    const ts = 1_700_000_000;
    const sig = sign(secret, ts, body);
    await expect(
      verifyWebhook({
        body: '{"event":"environment.deleted"}',
        signature: `ts=${ts};sig=${sig}`,
        secret,
        now: () => ts,
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('throws WebhookTimestampError for stale timestamps outside the tolerance window', async () => {
    const ts = 1_700_000_000;
    const sig = sign(secret, ts, body);
    const err = await verifyWebhook({
      body,
      signature: `ts=${ts};sig=${sig}`,
      secret,
      now: () => ts + 600, // 10 minutes later
      toleranceSeconds: 300,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(WebhookTimestampError);
    // Both failure classes share a catchable base.
    expect(err).toBeInstanceOf(WebhookVerificationError);
    expect(err).not.toBeInstanceOf(WebhookSignatureError);
  });

  it('accepts stale timestamps when tolerance is disabled', async () => {
    const ts = 1_700_000_000;
    const sig = sign(secret, ts, body);
    const payload = await verifyWebhook({
      body,
      signature: `ts=${ts};sig=${sig}`,
      secret,
      now: () => ts + 99_999,
      toleranceSeconds: 0,
    });
    expect(payload.event).toBe('environment.updated');
  });

  it('throws WebhookSignatureError for malformed headers', async () => {
    await expect(verifyWebhook({ body, signature: '', secret })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    await expect(verifyWebhook({ body, signature: null, secret })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    await expect(verifyWebhook({ body, signature: 'garbage', secret })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    await expect(
      verifyWebhook({ body, signature: 'ts=abc;sig=def', secret }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});
