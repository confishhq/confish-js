import type { HttpClient } from './http.js';
import type { FeedItem } from './types.js';

export interface FeedSetOptions {
  /**
   * Time-to-live in seconds (1..2592000). Omit for a permanent item.
   * PUT is a declarative full replace: omitting `ttl` also CLEARS any TTL
   * previously set on the item.
   */
  ttl?: number;
  signal?: AbortSignal;
}

export interface FeedItemInput<TData = Record<string, unknown>> {
  external_id: string;
  data: TData;
  /** Time-to-live in seconds (1..2592000). Omit for a permanent item. */
  ttl?: number;
}

export interface FeedReplaceResult {
  created: number;
  updated: number;
  deleted: number;
}

/**
 * A handle bound to a single feed by slug. Constructing it performs no HTTP;
 * requests happen when methods are called.
 */
export class Feed<TData extends object = Record<string, unknown>> {
  constructor(
    private readonly http: HttpClient,
    private readonly envId: string,
    private readonly slug: string,
  ) {}

  /**
   * Upserts an item (PUT): creates it if `externalId` is new, replaces it otherwise.
   * Omitting `ttl` makes the item permanent — and clears an existing TTL, since PUT
   * replaces the item declaratively.
   */
  set(externalId: string, data: TData, options: FeedSetOptions = {}): Promise<FeedItem<TData>> {
    return this.http.request<FeedItem<TData>>({
      method: 'PUT',
      path: `${this.itemsPath()}/${encodeURIComponent(externalId)}`,
      body: typeof options.ttl === 'number' ? { data, ttl: options.ttl } : { data },
      signal: options.signal,
    });
  }

  /**
   * Replaces the ENTIRE feed with exactly these items (collection PUT) — built for
   * sync-style cron jobs that push their full dataset in one request. Existing IDs
   * update in place, new IDs are created, and any item ABSENT from `items` is
   * DELETED; an empty array clears the feed. All-or-nothing: duplicate external_ids
   * or any schema-invalid item rejects the whole request with nothing written.
   */
  replace(items: FeedItemInput<TData>[], signal?: AbortSignal): Promise<FeedReplaceResult> {
    return this.http.request<FeedReplaceResult>({
      method: 'PUT',
      path: this.itemsPath(),
      body: {
        items: items.map(({ external_id, data, ttl }) =>
          typeof ttl === 'number' ? { external_id, data, ttl } : { external_id, data },
        ),
      },
      signal,
    });
  }

  /** List the feed's live items, newest first. */
  async list(signal?: AbortSignal): Promise<FeedItem<TData>[]> {
    const response = await this.http.request<{ items: FeedItem<TData>[] }>({
      method: 'GET',
      path: this.itemsPath(),
      signal,
    });
    return response.items;
  }

  /** Delete an item. Idempotent — deleting an item that doesn't exist succeeds. */
  async delete(externalId: string, signal?: AbortSignal): Promise<void> {
    await this.http.request<null>({
      method: 'DELETE',
      path: `${this.itemsPath()}/${encodeURIComponent(externalId)}`,
      signal,
    });
  }

  private itemsPath(): string {
    return `/c/${this.envId}/feeds/${this.slug}/items`;
  }
}
