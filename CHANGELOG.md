# @confish/sdk

## 0.2.0

### Added

- **Feeds.** `client.feed<TData>(slug)` returns a bound handle with
  `set(externalId, data, { ttl?, signal? })`, `replace(items, signal?)`,
  `list(signal?)`, and `delete(externalId, signal?)`. `set` is a
  declarative upsert (PUT): omitting `ttl` makes the item permanent and
  clears any existing TTL. `replace` swaps the entire feed for the given
  items in one all-or-nothing request — absent items are deleted, and an
  empty array clears the feed. New `FeedItem<TData>`, `FeedSetOptions`,
  `FeedItemInput<TData>`, and `FeedReplaceResult` types.
- `NotFoundError` — 404 responses now throw a dedicated error instead of
  falling through to the base `ConfishError`.
- `emergency` log level, completing the RFC 5424 set.

### Breaking changes

- **Config namespace.** `client.fetch()`, `client.update()`, and
  `client.replace()` moved to `client.config.fetch()`,
  `client.config.update()`, and `client.config.replace()`. The root
  methods are removed.
- **Logs consolidation.** `client.logger` is renamed to `client.logs`,
  and the flat `client.log(entry)` is removed — use
  `client.logs.write(entry)`. Per-level helpers
  (`client.logs.info(...)` etc.) are unchanged. The `Logger` class
  export is renamed to `Logs`.
- **Webhook verification.** `verifyWebhook(options)` now resolves with
  the parsed `WebhookPayload` instead of a boolean, and throws
  `WebhookSignatureError` (missing/malformed/mismatching signature) or
  `WebhookTimestampError` (timestamp outside the tolerance window) —
  both extend `WebhookVerificationError` — instead of returning `false`.
- **Actions.** `client.actions.update()` is renamed to
  `client.actions.progress()`, and the consumer context's `ctx.update()`
  to `ctx.progress()`. The `ActionUpdateInput` type is renamed to
  `ActionProgressInput`.

## 0.1.0

- Initial release: typed configuration (`fetch`/`update`/`replace`),
  actions with a long-running consumer loop, logging helpers, and
  webhook signature verification.
