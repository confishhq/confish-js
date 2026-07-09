import type { HttpClient } from './http.js';
import type { LogEntryInput, LogEntryResponse } from './types.js';

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
