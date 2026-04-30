import { describe, expect, it } from 'vitest';

import {
  AuthError,
  Confish,
  ConflictError,
  RateLimitError,
  ValidationError,
} from '../src/index.js';
import { mockFetch } from './helpers.js';

interface MyConfig {
  site_name: string;
  max_upload_mb: number;
  maintenance_mode: boolean;
}

describe('Confish client', () => {
  it('fetches typed configuration', async () => {
    const { fetch, calls } = mockFetch([
      {
        status: 200,
        body: { site_name: 'My App', max_upload_mb: 25, maintenance_mode: false },
      },
    ]);
    const client = new Confish<MyConfig>({
      envId: 'env_123',
      apiKey: 'confish_sk_test',
      baseUrl: 'https://confi.sh',
      fetch,
    });

    const config = await client.fetch();

    expect(config.site_name).toBe('My App');
    expect(config.max_upload_mb).toBe(25);
    expect(calls[0]).toMatchObject({
      url: 'https://confi.sh/c/env_123',
      method: 'GET',
    });
    expect(calls[0]!.headers.authorization).toBe('Bearer confish_sk_test');
  });

  it('partial-updates via PATCH with values wrapper', async () => {
    const { fetch, calls } = mockFetch([
      { status: 200, body: { site_name: 'My App', max_upload_mb: 50, maintenance_mode: true } },
    ]);
    const client = new Confish<MyConfig>({ envId: 'env_123', apiKey: 'k', fetch });

    await client.update({ maintenance_mode: true, max_upload_mb: 50 });

    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.body).toEqual({ values: { maintenance_mode: true, max_upload_mb: 50 } });
  });

  it('replaces all values via PUT', async () => {
    const { fetch, calls } = mockFetch([{ status: 200, body: {} }]);
    const client = new Confish<MyConfig>({ envId: 'env_123', apiKey: 'k', fetch });

    await client.replace({ site_name: 'X', max_upload_mb: 1, maintenance_mode: false });

    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.body).toEqual({
      values: { site_name: 'X', max_upload_mb: 1, maintenance_mode: false },
    });
  });

  it('throws AuthError on 401', async () => {
    const { fetch } = mockFetch([{ status: 401, body: { error: 'Missing API key' } }]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    await expect(client.fetch()).rejects.toBeInstanceOf(AuthError);
  });

  it('throws ValidationError with field errors on 422', async () => {
    const { fetch } = mockFetch([
      {
        status: 422,
        body: {
          message: 'The given data was invalid.',
          errors: { 'values.max_upload_mb': ['Must be at most 100.'] },
        },
      },
    ]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    const err = await client.update({ x: 1 } as never).catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).errors).toEqual({
      'values.max_upload_mb': ['Must be at most 100.'],
    });
  });

  it('retries on 429 honoring Retry-After then succeeds', async () => {
    const { fetch, calls } = mockFetch([
      { status: 429, body: { error: 'rate limited' }, headers: { 'retry-after': '0' } },
      { status: 200, body: { site_name: 'ok' } },
    ]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch, maxRetries: 1 });

    const res = await client.fetch();

    expect(res).toEqual({ site_name: 'ok' });
    expect(calls).toHaveLength(2);
  });

  it('exhausts retries and throws RateLimitError', async () => {
    const { fetch } = mockFetch([
      { status: 429, body: { error: 'limited' }, headers: { 'retry-after': '0', 'x-ratelimit-limit': '60' } },
    ]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch, maxRetries: 1 });

    const err = await client.fetch().catch((e) => e);

    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).limit).toBe(60);
  });

  it('throws ConflictError on 409', async () => {
    const { fetch } = mockFetch([{ status: 409, body: { error: 'conflict' } }]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    await expect(client.actions.ack('a1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('logs via the logger helpers', async () => {
    const { fetch, calls } = mockFetch([{ status: 201, body: { id: 'log_1' } }]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    await client.logger.info('hello', { user_id: 1 });

    expect(calls[0]!.body).toEqual({
      level: 'info',
      message: 'hello',
      context: { user_id: 1 },
    });
  });
});
