import { Actions } from './actions.js';
import { HttpClient } from './http.js';
import type { LogEntryInput, LogEntryResponse, LogLevel } from './types.js';

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
  readonly actions: Actions;
  readonly logger: Logger;

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

    this.actions = new Actions(this.http, this.envId);
    this.logger = new Logger(this);
  }

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

  /** Send a log entry. */
  log(entry: LogEntryInput, signal?: AbortSignal): Promise<LogEntryResponse> {
    return this.http.request<LogEntryResponse>({
      method: 'POST',
      path: `/c/${this.envId}/log`,
      body: entry,
      signal,
    });
  }
}

export class Logger {
  constructor(private readonly client: { log(entry: LogEntryInput): Promise<LogEntryResponse> }) {}

  debug(message: string, context?: Record<string, unknown>) {
    return this.send('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>) {
    return this.send('info', message, context);
  }
  notice(message: string, context?: Record<string, unknown>) {
    return this.send('notice', message, context);
  }
  warning(message: string, context?: Record<string, unknown>) {
    return this.send('warning', message, context);
  }
  error(message: string, context?: Record<string, unknown>) {
    return this.send('error', message, context);
  }
  critical(message: string, context?: Record<string, unknown>) {
    return this.send('critical', message, context);
  }
  alert(message: string, context?: Record<string, unknown>) {
    return this.send('alert', message, context);
  }

  private send(level: LogLevel, message: string, context?: Record<string, unknown>) {
    return this.client.log(context ? { level, message, context } : { level, message });
  }
}
