import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifyWebhook } from '../src/webhook.js';

function sign(secret: string, ts: number, body: string): string {
  return createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
}

describe('verifyWebhook', () => {
  const secret = 'whsec_test';
  const body = '{"event":"environment.updated"}';

  it('accepts a valid signature', async () => {
    const ts = 1_700_000_000;
    const sig = sign(secret, ts, body);
    const ok = await verifyWebhook({
      body,
      signature: `ts=${ts};sig=${sig}`,
      secret,
      now: () => ts,
    });
    expect(ok).toBe(true);
  });

  it('rejects when the secret is wrong', async () => {
    const ts = 1_700_000_000;
    const sig = sign('different', ts, body);
    const ok = await verifyWebhook({
      body,
      signature: `ts=${ts};sig=${sig}`,
      secret,
      now: () => ts,
    });
    expect(ok).toBe(false);
  });

  it('rejects when the body is tampered', async () => {
    const ts = 1_700_000_000;
    const sig = sign(secret, ts, body);
    const ok = await verifyWebhook({
      body: '{"event":"environment.deleted"}',
      signature: `ts=${ts};sig=${sig}`,
      secret,
      now: () => ts,
    });
    expect(ok).toBe(false);
  });

  it('rejects stale timestamps outside the tolerance window', async () => {
    const ts = 1_700_000_000;
    const sig = sign(secret, ts, body);
    const ok = await verifyWebhook({
      body,
      signature: `ts=${ts};sig=${sig}`,
      secret,
      now: () => ts + 600, // 10 minutes later
      toleranceSeconds: 300,
    });
    expect(ok).toBe(false);
  });

  it('accepts stale timestamps when tolerance is disabled', async () => {
    const ts = 1_700_000_000;
    const sig = sign(secret, ts, body);
    const ok = await verifyWebhook({
      body,
      signature: `ts=${ts};sig=${sig}`,
      secret,
      now: () => ts + 99_999,
      toleranceSeconds: 0,
    });
    expect(ok).toBe(true);
  });

  it('rejects malformed headers', async () => {
    expect(await verifyWebhook({ body, signature: '', secret })).toBe(false);
    expect(await verifyWebhook({ body, signature: null, secret })).toBe(false);
    expect(await verifyWebhook({ body, signature: 'garbage', secret })).toBe(false);
    expect(
      await verifyWebhook({ body, signature: 'ts=abc;sig=def', secret }),
    ).toBe(false);
  });
});
