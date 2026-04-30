import { ConflictError } from './errors.js';
import type { HttpClient } from './http.js';
import type { Action } from './types.js';

export interface ActionUpdateInput {
  message: string;
  data?: Record<string, unknown>;
}

export interface ActionConsumeOptions<TResult = Record<string, unknown>> {
  /** Process the action. Return value becomes `result` on completion; throwing fails the action. */
  handler: (action: Action, ctx: ActionContext) => Promise<TResult | void> | TResult | void;
  /**
   * Base delay between polls when no actions are pending. Default: 15000 (15s).
   * After 3 consecutive empty polls the delay doubles each poll up to maxPollIntervalMs,
   * resetting to this base as soon as an action is processed.
   */
  pollIntervalMs?: number;
  /** Cap on the adaptive backoff delay. Default: 60000 (60s). */
  maxPollIntervalMs?: number;
  /** Max actions processed in parallel. Default: 1 (sequential). */
  concurrency?: number;
  /** Stop the loop. */
  signal?: AbortSignal;
  /** Called when the handler throws — runs after the action is marked failed. */
  onError?: (error: unknown, action: Action) => void;
}

export interface ActionContext {
  /** Append a timeline update visible in the dashboard. */
  update(message: string, data?: Record<string, unknown>): Promise<Action>;
  /** True once the consume() loop has been signaled to stop. */
  readonly signal: AbortSignal | undefined;
}

export class Actions {
  constructor(
    private readonly http: HttpClient,
    private readonly envId: string,
  ) {}

  /** List pending, non-expired actions ordered oldest first. */
  async list(signal?: AbortSignal): Promise<Action[]> {
    const response = await this.http.request<{ actions: Action[] }>({
      method: 'GET',
      path: `/c/${this.envId}/actions`,
      signal,
    });
    return response.actions;
  }

  /** Acknowledge an action. Throws ConflictError if it's no longer pending. */
  ack(actionId: string, signal?: AbortSignal): Promise<Action> {
    return this.http.request<Action>({
      method: 'POST',
      path: `/c/${this.envId}/actions/${actionId}/ack`,
      signal,
    });
  }

  /** Append a timeline update. */
  update(actionId: string, input: ActionUpdateInput, signal?: AbortSignal): Promise<Action> {
    return this.http.request<Action>({
      method: 'POST',
      path: `/c/${this.envId}/actions/${actionId}/update`,
      body: input,
      signal,
    });
  }

  /** Mark an action as completed with an optional result payload. */
  complete(
    actionId: string,
    result?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Action> {
    return this.http.request<Action>({
      method: 'POST',
      path: `/c/${this.envId}/actions/${actionId}/complete`,
      body: result !== undefined ? { result } : {},
      signal,
    });
  }

  /** Mark an action as failed with an optional result payload. */
  fail(
    actionId: string,
    result?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Action> {
    return this.http.request<Action>({
      method: 'POST',
      path: `/c/${this.envId}/actions/${actionId}/fail`,
      body: result !== undefined ? { result } : {},
      signal,
    });
  }

  /**
   * Long-running consumer loop. Polls for actions, acknowledges them, runs the handler,
   * and completes or fails based on the handler's outcome. Returns when the signal aborts.
   */
  async consume<TResult extends Record<string, unknown> = Record<string, unknown>>(
    options: ActionConsumeOptions<TResult>,
  ): Promise<void> {
    const baseIntervalMs = options.pollIntervalMs ?? 15_000;
    const maxIntervalMs = options.maxPollIntervalMs ?? 60_000;
    const concurrency = Math.max(1, options.concurrency ?? 1);
    const signal = options.signal;
    const inFlight = new Set<Promise<void>>();
    let emptyPolls = 0;

    while (!signal?.aborted) {
      let actions: Action[];
      try {
        actions = await this.list(signal);
      } catch (err) {
        if (isAbortError(err)) return;
        options.onError?.(err, placeholderAction());
        await sleep(backoffDelay(emptyPolls, baseIntervalMs, maxIntervalMs), signal);
        continue;
      }

      const pending = actions.filter((a) => a.status === 'pending');

      if (pending.length === 0) {
        emptyPolls += 1;
        await sleep(backoffDelay(emptyPolls, baseIntervalMs, maxIntervalMs), signal);
        continue;
      }

      emptyPolls = 0;

      for (const action of pending) {
        while (inFlight.size >= concurrency) {
          await Promise.race(inFlight);
        }
        if (signal?.aborted) return;

        const task = this.processAction(action, options).finally(() => {
          inFlight.delete(task);
        });
        inFlight.add(task);
      }
    }

    await Promise.allSettled(inFlight);
  }

  private async processAction<TResult extends Record<string, unknown>>(
    action: Action,
    options: ActionConsumeOptions<TResult>,
  ): Promise<void> {
    const signal = options.signal;

    try {
      await this.ack(action.id, signal);
    } catch (err) {
      // 409 means another consumer (or the expiry job) got there first. Silently skip.
      if (err instanceof ConflictError) return;
      if (isAbortError(err)) return;
      options.onError?.(err, action);
      return;
    }

    const ctx: ActionContext = {
      signal,
      update: (message, data) =>
        this.update(action.id, data !== undefined ? { message, data } : { message }, signal),
    };

    try {
      const result = await options.handler(action, ctx);
      if (signal?.aborted) return;
      await this.complete(
        action.id,
        result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined,
        signal,
      );
    } catch (err) {
      if (isAbortError(err)) return;
      options.onError?.(err, action);
      try {
        await this.fail(action.id, { error: errorMessage(err) }, signal);
      } catch (failErr) {
        if (!isAbortError(failErr)) options.onError?.(failErr, action);
      }
    }
  }
}

/**
 * Stays at base for the first 3 empty polls, then doubles each subsequent empty poll
 * up to max. Resets the moment the loop processes an action.
 */
function backoffDelay(emptyPolls: number, base: number, max: number): number {
  if (emptyPolls <= 3) return base;
  return Math.min(base * 2 ** (emptyPolls - 3), max);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Used only as a placeholder for onError when listing fails before we have a real action.
function placeholderAction(): Action {
  return {
    id: '',
    type: '',
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
