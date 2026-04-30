import { ConfishError, NetworkError, RateLimitError, errorFromResponse } from './errors.js';

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
  /** Max retry attempts on 429 / 5xx. Default: 2 (3 total attempts). */
  maxRetries?: number;
  /** Cap on Retry-After honoring, in seconds. Default: 30. */
  maxRetryDelaySeconds?: number;
}

export interface RequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  signal?: AbortSignal;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly userAgent: string;
  private readonly maxRetries: number;
  private readonly maxRetryDelay: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.userAgent = options.userAgent ?? '@confish/sdk';
    this.maxRetries = options.maxRetries ?? 2;
    this.maxRetryDelay = options.maxRetryDelaySeconds ?? 30;
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${options.path}`;
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        'User-Agent': this.userAgent,
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    };

    let attempt = 0;
    while (true) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, init);
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AbortError') throw cause;
        throw new NetworkError(`Network request to ${url} failed`, cause);
      }

      if (response.ok) {
        return (await parseJson(response)) as T;
      }

      const body = await parseJson(response);
      const error = errorFromResponse(response.status, body, response.headers);

      const shouldRetry =
        attempt < this.maxRetries &&
        (error instanceof RateLimitError || (error.status !== undefined && error.status >= 500));

      if (!shouldRetry) throw error;

      const delaySeconds =
        error instanceof RateLimitError && error.retryAfter !== undefined
          ? Math.min(error.retryAfter, this.maxRetryDelay)
          : Math.min(2 ** attempt, this.maxRetryDelay);

      await sleep(delaySeconds * 1000, options.signal);
      attempt += 1;
    }
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ConfishError('Failed to parse response body as JSON', {
      status: response.status,
      body: text,
      cause,
    });
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signalReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signalReason(signal!));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function signalReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}
