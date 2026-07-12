import type { HttpClient } from './http.js';
import type { LogBatchEntryInput, LogEntryInput, LogEntryResponse } from './types.js';

const MAX_BATCH_ENTRIES = 100;

export class Logs {
  constructor(
    private readonly http: HttpClient,
    private readonly envId: string,
  ) {}

  /** Send a log entry. */
  write(entry: LogEntryInput, signal?: AbortSignal): Promise<LogEntryResponse> {
    return this.http.request<LogEntryResponse>({
      method: 'POST',
      path: `/c/${this.envId}/log`,
      body: entry,
      signal,
    });
  }

  /**
   * Send up to 100 log entries in one request. Resolves with the created entry ids,
   * in the same order as `entries`. Each entry may carry an ISO8601 `timestamp` to
   * record when it happened; omitted timestamps default to the server's receive time.
   * More than 100 entries throws a `RangeError` without making a request; an empty
   * array resolves to `[]` without making a request.
   */
  async writeBatch(entries: LogBatchEntryInput[], signal?: AbortSignal): Promise<string[]> {
    if (entries.length > MAX_BATCH_ENTRIES) {
      throw new RangeError(
        `writeBatch accepts at most ${MAX_BATCH_ENTRIES} entries per request, got ${entries.length}`,
      );
    }
    if (entries.length === 0) return [];

    const response = await this.http.request<{ ids: string[] }>({
      method: 'POST',
      path: `/c/${this.envId}/logs`,
      body: { entries },
      signal,
    });
    return response.ids;
  }

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
  emergency(message: string, context?: Record<string, unknown>) {
    return this.send('emergency', message, context);
  }

  private send(level: LogEntryInput['level'], message: string, context?: Record<string, unknown>) {
    return this.write(context ? { level, message, context } : { level, message });
  }
}
