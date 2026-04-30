import { describe, expect, it } from 'vitest';

import { Confish } from '../src/index.js';
import type { Action } from '../src/index.js';
import { mockFetch } from './helpers.js';

function pendingAction(id: string, type = 'noop'): Action {
  return {
    id,
    type,
    params: null,
    status: 'pending',
    updates: [],
    result: null,
    expires_at: null,
    acknowledged_at: null,
    completed_at: null,
    created_at: null,
  };
}

describe('Actions', () => {
  it('lists actions (unwrapping the actions array)', async () => {
    const { fetch } = mockFetch([
      { status: 200, body: { actions: [pendingAction('a1'), pendingAction('a2')] } },
    ]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    const actions = await client.actions.list();

    expect(actions).toHaveLength(2);
    expect(actions[0]!.id).toBe('a1');
  });

  it('completes with a result body', async () => {
    const { fetch, calls } = mockFetch([{ status: 200, body: pendingAction('a1') }]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    await client.actions.complete('a1', { ok: true });

    expect(calls[0]!.body).toEqual({ result: { ok: true } });
  });

  it('completes without a body when no result is given', async () => {
    const { fetch, calls } = mockFetch([{ status: 200, body: pendingAction('a1') }]);
    const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });

    await client.actions.complete('a1');

    expect(calls[0]!.body).toEqual({});
  });

  describe('consume()', () => {
    it('runs handler, completes successfully, then stops on abort', async () => {
      const action = pendingAction('a1', 'place_order');
      let listCalls = 0;
      const { fetch, calls } = mockFetch((req) => {
        if (req.method === 'GET' && req.url.endsWith('/actions')) {
          listCalls += 1;
          return {
            status: 200,
            body: { actions: listCalls === 1 ? [action] : [] },
          };
        }
        return { status: 200, body: action };
      });

      const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });
      const ctrl = new AbortController();

      const handler = async (a: Action) => {
        expect(a.id).toBe('a1');
        return { filled: true };
      };

      const consumePromise = client.actions.consume({
        handler,
        pollIntervalMs: 5,
        signal: ctrl.signal,
      });

      // Wait for ack + complete to land, then stop the loop.
      await new Promise((r) => setTimeout(r, 50));
      ctrl.abort();
      await consumePromise;

      const ack = calls.find((c) => c.url.endsWith('/ack'));
      const complete = calls.find((c) => c.url.endsWith('/complete'));
      expect(ack).toBeDefined();
      expect(complete).toBeDefined();
      expect(complete!.body).toEqual({ result: { filled: true } });
    });

    it('marks action as failed when handler throws', async () => {
      const action = pendingAction('a1');
      let listCalls = 0;
      const { fetch, calls } = mockFetch((req) => {
        if (req.method === 'GET' && req.url.endsWith('/actions')) {
          listCalls += 1;
          return { status: 200, body: { actions: listCalls === 1 ? [action] : [] } };
        }
        return { status: 200, body: action };
      });

      const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });
      const ctrl = new AbortController();

      const consumePromise = client.actions.consume({
        handler: async () => {
          throw new Error('boom');
        },
        pollIntervalMs: 5,
        signal: ctrl.signal,
      });

      await new Promise((r) => setTimeout(r, 50));
      ctrl.abort();
      await consumePromise;

      const fail = calls.find((c) => c.url.endsWith('/fail'));
      expect(fail).toBeDefined();
      expect(fail!.body).toEqual({ result: { error: 'boom' } });
    });

    it('skips silently on 409 ack conflict', async () => {
      const action = pendingAction('a1');
      let listCalls = 0;
      let handlerRan = false;
      const { fetch, calls } = mockFetch((req) => {
        if (req.method === 'GET' && req.url.endsWith('/actions')) {
          listCalls += 1;
          return { status: 200, body: { actions: listCalls === 1 ? [action] : [] } };
        }
        if (req.url.endsWith('/ack')) {
          return { status: 409, body: { error: 'already acknowledged' } };
        }
        return { status: 200, body: action };
      });

      const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });
      const ctrl = new AbortController();

      const consumePromise = client.actions.consume({
        handler: async () => {
          handlerRan = true;
        },
        pollIntervalMs: 5,
        signal: ctrl.signal,
      });

      await new Promise((r) => setTimeout(r, 50));
      ctrl.abort();
      await consumePromise;

      expect(handlerRan).toBe(false);
      expect(calls.find((c) => c.url.endsWith('/complete'))).toBeUndefined();
      expect(calls.find((c) => c.url.endsWith('/fail'))).toBeUndefined();
    });

    it('exposes ctx.update() for progress reporting', async () => {
      const action = pendingAction('a1');
      let listCalls = 0;
      const { fetch, calls } = mockFetch((req) => {
        if (req.method === 'GET' && req.url.endsWith('/actions')) {
          listCalls += 1;
          return { status: 200, body: { actions: listCalls === 1 ? [action] : [] } };
        }
        return { status: 200, body: action };
      });

      const client = new Confish({ envId: 'env_123', apiKey: 'k', fetch });
      const ctrl = new AbortController();

      const consumePromise = client.actions.consume({
        handler: async (_a, ctx) => {
          await ctx.update('half done', { progress: 0.5 });
        },
        pollIntervalMs: 5,
        signal: ctrl.signal,
      });

      await new Promise((r) => setTimeout(r, 50));
      ctrl.abort();
      await consumePromise;

      const update = calls.find((c) => c.url.endsWith('/update'));
      expect(update!.body).toEqual({ message: 'half done', data: { progress: 0.5 } });
    });
  });
});
