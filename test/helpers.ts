export interface MockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface MockedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockFetch {
  fetch: typeof globalThis.fetch;
  calls: MockedRequest[];
}

/**
 * Build a fake fetch that returns queued responses in order. If the queue is empty,
 * the last response is repeated (useful for polling tests where the loop reads the
 * "no actions" response repeatedly).
 */
export function mockFetch(responses: MockResponse[] | ((req: MockedRequest) => MockResponse)): MockFetch {
  const calls: MockedRequest[] = [];
  const queue = Array.isArray(responses) ? [...responses] : null;

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => {
        headers[k] = v;
      });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const req: MockedRequest = { url, method, headers, body };
    calls.push(req);

    const response = queue
      ? queue.length > 1
        ? queue.shift()!
        : queue[0] ?? { status: 200, body: null }
      : (responses as (req: MockedRequest) => MockResponse)(req);

    return new Response(response.body !== undefined ? JSON.stringify(response.body) : null, {
      status: response.status,
      headers: {
        'content-type': 'application/json',
        ...response.headers,
      },
    });
  };

  return { fetch, calls };
}
