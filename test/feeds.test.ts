import { describe, expect, it } from 'vitest';

import { Confish, NotFoundError, ValidationError } from '../src/index.js';
import type { FeedItem } from '../src/index.js';
import { mockFetch } from './helpers.js';

interface JobItem {
  url: string;
  priority: number;
}

function feedItem(externalId: string, data: JobItem): FeedItem<JobItem> {
  return {
    id: 'fi_1',
    external_id: externalId,
    data,
    expires_at: null,
    created_at: '2026-07-09T00:00:00Z',
    updated_at: '2026-07-09T00:00:00Z',
  };
}

describe('Feed', () => {
  it('sets an item with a ttl via PUT', async () => {
    const data: JobItem = { url: 'https://example.com/sitemap.xml', priority: 1 };
    const { fetch, calls } = mockFetch([{ status: 200, body: feedItem('sitemap-crawl', data) }]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    const item = await client.feed<JobItem>('jobs').set('sitemap-crawl', data, { ttl: 86_400 });

    expect(calls[0]).toMatchObject({
      url: 'https://confi.sh/c/env_123/feeds/jobs/items/sitemap-crawl',
      method: 'PUT',
    });
    expect(calls[0]!.body).toEqual({ data, ttl: 86_400 });
    expect(item.external_id).toBe('sitemap-crawl');
    expect(item.data.priority).toBe(1);
  });

  it('omits the ttl key when unset — the item becomes permanent', async () => {
    const data: JobItem = { url: 'https://example.com', priority: 2 };
    const { fetch, calls } = mockFetch([{ status: 200, body: feedItem('sitemap-crawl', data) }]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    await client.feed<JobItem>('jobs').set('sitemap-crawl', data);

    expect(calls[0]!.body).toEqual({ data });
    expect(Object.keys(calls[0]!.body as object)).toEqual(['data']);
  });

  it('replaces the whole feed via collection PUT, omitting ttl keys when unset', async () => {
    const { fetch, calls } = mockFetch([
      { status: 200, body: { created: 1, updated: 1, deleted: 3 } },
    ]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    const result = await client.feed<JobItem>('jobs').replace([
      { external_id: 'sitemap-crawl', data: { url: 'https://a.example', priority: 1 }, ttl: 86_400 },
      { external_id: 'robots-check', data: { url: 'https://b.example', priority: 2 } },
    ]);

    expect(calls[0]).toMatchObject({
      url: 'https://confi.sh/c/env_123/feeds/jobs/items',
      method: 'PUT',
    });
    expect(calls[0]!.body).toEqual({
      items: [
        { external_id: 'sitemap-crawl', data: { url: 'https://a.example', priority: 1 }, ttl: 86_400 },
        { external_id: 'robots-check', data: { url: 'https://b.example', priority: 2 } },
      ],
    });
    const [, second] = (calls[0]!.body as { items: object[] }).items;
    expect(Object.keys(second!)).toEqual(['external_id', 'data']);
    expect(result).toEqual({ created: 1, updated: 1, deleted: 3 });
  });

  it('clears the feed when replacing with an empty array', async () => {
    const { fetch, calls } = mockFetch([
      { status: 200, body: { created: 0, updated: 0, deleted: 7 } },
    ]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    const result = await client.feed('jobs').replace([]);

    expect(calls[0]!.body).toEqual({ items: [] });
    expect(result).toEqual({ created: 0, updated: 0, deleted: 7 });
  });

  it('throws ValidationError when any replaced item fails the feed schema', async () => {
    const { fetch } = mockFetch([
      {
        status: 422,
        body: {
          message: 'The given data was invalid.',
          errors: { 'items.1.data.priority': ['Must be an integer.'] },
        },
      },
    ]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    const err = await client
      .feed('jobs')
      .replace([
        { external_id: 'ok', data: { priority: 1 } },
        { external_id: 'bad', data: { priority: 'high' } },
      ])
      .catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).errors).toEqual({
      'items.1.data.priority': ['Must be an integer.'],
    });
  });

  it('lists items (unwrapping the items array)', async () => {
    const { fetch, calls } = mockFetch([
      {
        status: 200,
        body: {
          items: [
            feedItem('b', { url: 'https://b.example', priority: 2 }),
            feedItem('a', { url: 'https://a.example', priority: 1 }),
          ],
        },
      },
    ]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    const items = await client.feed<JobItem>('jobs').list();

    expect(calls[0]).toMatchObject({
      url: 'https://confi.sh/c/env_123/feeds/jobs/items',
      method: 'GET',
    });
    expect(items).toHaveLength(2);
    expect(items[0]!.external_id).toBe('b');
  });

  it('deletes an item and resolves with no value on 204', async () => {
    const { fetch, calls } = mockFetch([{ status: 204 }]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    const result = await client.feed('jobs').delete('sitemap-crawl');

    expect(result).toBeUndefined();
    expect(calls[0]).toMatchObject({
      url: 'https://confi.sh/c/env_123/feeds/jobs/items/sitemap-crawl',
      method: 'DELETE',
    });
  });

  it('throws NotFoundError for an unknown feed slug', async () => {
    const { fetch } = mockFetch([{ status: 404, body: { error: 'Feed not found' } }]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    const err = await client.feed('typo').list().catch((e) => e);

    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).status).toBe(404);
    expect((err as NotFoundError).message).toBe('Feed not found');
  });

  it('throws ValidationError when the item fails the feed schema', async () => {
    const { fetch } = mockFetch([
      {
        status: 422,
        body: {
          message: 'The given data was invalid.',
          errors: { 'data.priority': ['Must be an integer.'] },
        },
      },
    ]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    const err = await client
      .feed('jobs')
      .set('sitemap-crawl', { priority: 'high' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).errors).toEqual({
      'data.priority': ['Must be an integer.'],
    });
  });
});
