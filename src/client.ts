import { Actions } from './actions.js';
import { Config } from './config.js';
import { Feed } from './feeds.js';
import { HttpClient } from './http.js';
import { Logs } from './logs.js';

export interface ConfishOptions {
  envId: string;
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  userAgent?: string;
  maxRetries?: number;
}

const DEFAULT_BASE_URL = 'https://confi.sh';

export class Confish<T extends object = Record<string, unknown>> {
  readonly config: Config<T>;
  readonly actions: Actions;
  readonly logs: Logs;

  private readonly http: HttpClient;
  private readonly envId: string;

  constructor(options: ConfishOptions) {
    if (!options.envId) throw new TypeError('envId is required');
    if (!options.apiKey) throw new TypeError('apiKey is required');

    this.envId = options.envId;
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      apiKey: options.apiKey,
      fetch: options.fetch,
      userAgent: options.userAgent,
      maxRetries: options.maxRetries,
    });

    this.config = new Config<T>(this.http, this.envId);
    this.actions = new Actions(this.http, this.envId);
    this.logs = new Logs(this.http, this.envId);
  }

  /** Get a handle bound to a feed by slug. Makes no HTTP request until a method is called. */
  feed<TData extends object = Record<string, unknown>>(slug: string): Feed<TData> {
    return new Feed<TData>(this.http, this.envId, slug);
  }
}
