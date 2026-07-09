export type ConfigValues = Record<string, unknown>;

export type LogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

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

export interface FeedItem<TData = Record<string, unknown>> {
  id: string;
  external_id: string;
  data: TData;
  /** ISO8601 timestamp, or null when the item is permanent. */
  expires_at: string | null;
  created_at: string;
  updated_at: string;
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
