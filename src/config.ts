import type { HttpClient } from './http.js';

export class Config<T extends object = Record<string, unknown>> {
  constructor(
    private readonly http: HttpClient,
    private readonly envId: string,
  ) {}

  /** Fetch the environment's typed configuration. */
  fetch(signal?: AbortSignal): Promise<T> {
    return this.http.request<T>({
      method: 'GET',
      path: `/c/${this.envId}`,
      signal,
    });
  }

  /** Partial update (PATCH). Only listed fields are changed. */
  update(values: Partial<T>, signal?: AbortSignal): Promise<T> {
    return this.http.request<T>({
      method: 'PATCH',
      path: `/c/${this.envId}`,
      body: { values },
      signal,
    });
  }

  /** Replace all values (PUT). Omitted fields reset to defaults. */
  replace(values: T, signal?: AbortSignal): Promise<T> {
    return this.http.request<T>({
      method: 'PUT',
      path: `/c/${this.envId}`,
      body: { values },
      signal,
    });
  }
}
