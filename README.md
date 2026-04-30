# @confish/sdk

Official TypeScript/JavaScript SDK for [confish](https://confi.sh) — typed configuration, actions, and webhook verification.

- Fully typed configuration via a generic parameter
- Native `fetch`, no dependencies, works in Node 18+, Bun, Deno, Cloudflare Workers, Vercel Edge
- Long-running action consumer with abort signal and idempotent skip on conflict
- Webhook signature verification using Web Crypto

## Install

```sh
npm install @confish/sdk
# or
pnpm add @confish/sdk
# or
yarn add @confish/sdk
```

## Quick start

```ts
import { Confish } from '@confish/sdk';

type MyConfig = {
  site_name: string;
  max_upload_mb: number;
  maintenance_mode: boolean;
  launch_date: string;
  allowed_origins: string[];
};

const client = new Confish<MyConfig>({
  envId: 'a1b2c3d4e5f6',
  apiKey: process.env.CONFISH_API_KEY!,
});

const config = await client.fetch();
config.maintenance_mode; // typed as boolean
```

## Reading and writing config

```ts
// GET /c/{env_id}
const config = await client.fetch();

// PATCH — only listed fields change
await client.update({ maintenance_mode: true });

// PUT — replaces everything; omitted fields reset to defaults
await client.replace({
  site_name: 'My App',
  max_upload_mb: 50,
  maintenance_mode: false,
  launch_date: '2026-06-01',
  allowed_origins: ['https://example.com'],
});
```

Both `update` and `replace` return the full updated config in the same shape as `fetch()`, so you can confirm the result without a second request.

> Write access must be enabled in the environment settings before `update` and `replace` will work.

## Logging

```ts
await client.logger.info('Worker started', { region: 'eu-west-1' });
await client.logger.error('Job failed', { job_id: 'abc', err: String(e) });

// Or directly:
await client.log({ level: 'warning', message: 'High memory usage', context: { mb: 850 } });
```

Levels: `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`.

## Actions

The action consumer polls for pending actions, acknowledges them, runs your handler, and reports completion or failure — including idempotent skip if another consumer claimed the same action first.

```ts
import { Confish, type Action } from '@confish/sdk';

const client = new Confish({ envId: '...', apiKey: '...' });
const ctrl = new AbortController();

await client.actions.consume({
  signal: ctrl.signal,
  pollIntervalMs: 15_000,    // base — defaults to 15s
  maxPollIntervalMs: 60_000, // adaptive backoff cap — defaults to 60s
  concurrency: 2,
  handler: async (action: Action, ctx) => {
    if (action.type === 'place_order') {
      await ctx.update('Submitting order', { params: action.params });
      const order = await placeOrder(action.params);
      return { order_id: order.id, filled_price: order.price };
    }
    throw new Error(`Unknown action type: ${action.type}`);
  },
  onError: (err, action) => console.error('Action failed', action.id, err),
});

// On shutdown:
process.on('SIGTERM', () => ctrl.abort());
```

What happens automatically:
- The handler's return value (if any) becomes the action's `result` on completion.
- Throwing fails the action with `{ error: <message> }` as the result.
- `409 Conflict` on ack (already-acknowledged or expired) is silently skipped — safe to run multiple consumers.
- Aborting the signal stops new work and waits for in-flight handlers to settle.
- After 3 consecutive empty polls the loop doubles its sleep up to `maxPollIntervalMs`, resetting to `pollIntervalMs` the moment any action is processed. Idle consumers consume ~240 requests/hour by default instead of polling flat-out.

You can also call the action endpoints directly:

```ts
const actions = await client.actions.list();
await client.actions.ack('action_id');
await client.actions.update('action_id', { message: 'progress', data: { step: 2 } });
await client.actions.complete('action_id', { result_field: 'value' });
await client.actions.fail('action_id', { error: 'timeout' });
```

## Webhook verification

Imported separately so server-only crypto stays out of edge bundles that don't need it.

```ts
import { verifyWebhook } from '@confish/sdk/webhook';

// Express:
app.post('/webhook', express.text({ type: '*/*' }), async (req, res) => {
  const ok = await verifyWebhook({
    body: req.body, // raw string
    signature: req.headers['x-confish-signature'] as string,
    secret: process.env.CONFISH_WEBHOOK_SECRET!,
  });
  if (!ok) return res.status(401).send('Invalid signature');

  const payload = JSON.parse(req.body);
  // handle payload.event ...
  res.sendStatus(200);
});
```

The verifier uses constant-time comparison and rejects timestamps older than 5 minutes by default (override with `toleranceSeconds`). Always pass the **raw, unparsed body** — re-serializing parsed JSON breaks verification.

## Errors

Every failed request throws a typed error you can match on:

```ts
import {
  AuthError,
  ConfishError,
  ConflictError,
  ForbiddenError,
  NetworkError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '@confish/sdk';

try {
  await client.fetch();
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(`Slow down — retry after ${err.retryAfter}s`);
  } else if (err instanceof ValidationError) {
    console.log('Field errors:', err.errors);
  } else if (err instanceof ConfishError) {
    console.log(`HTTP ${err.status}: ${err.message}`);
  }
}
```

The client retries `429` (honoring `Retry-After`) and `5xx` responses up to twice by default. Tune with `maxRetries` on the `Confish` constructor.

## Options

```ts
new Confish<MyConfig>({
  envId: 'a1b2c3d4e5f6',
  apiKey: 'confish_sk_...',
  baseUrl: 'https://confi.sh', // override for self-hosted
  maxRetries: 2,                // attempts beyond the first
  fetch: globalThis.fetch,      // inject for testing or custom transport
  userAgent: 'my-app/1.0',
});
```

## License

MIT
