export type ConfigValues = Record<string, unknown>;

export type LogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert';

export interface LogEntryInput {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export interface LogEntryResponse {
  id: string;
}

export type ActionStatus =
  | 'pending'
  | 'acknowledged'
  | 'completed'
  | 'failed'
  | 'expired';

export interface ActionUpdate {
  message: string;
  data?: Record<string, unknown> | null;
  timestamp?: string;
}

export interface Action<TParams = Record<string, unknown>, TResult = Record<string, unknown>> {
  id: string;
  type: string;
  params: TParams | null;
  status: ActionStatus;
  updates: ActionUpdate[];
  result: TResult | null;
  expires_at: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  created_at: string | null;
}
