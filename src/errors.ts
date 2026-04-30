export class ConfishError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;

  constructor(message: string, options: { status?: number; body?: unknown; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ConfishError';
    this.status = options.status;
    this.body = options.body;
  }
}

export class NetworkError extends ConfishError {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'NetworkError';
  }
}

export class AuthError extends ConfishError {
  constructor(body: unknown) {
    super(messageFromBody(body, 'Missing or invalid API key'), { status: 401, body });
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends ConfishError {
  constructor(body: unknown) {
    super(messageFromBody(body, 'Forbidden'), { status: 403, body });
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends ConfishError {
  readonly errors: Record<string, string[]>;

  constructor(body: unknown) {
    super(messageFromBody(body, 'Validation failed'), { status: 422, body });
    this.name = 'ValidationError';
    this.errors = extractValidationErrors(body);
  }
}

export class ConflictError extends ConfishError {
  constructor(body: unknown) {
    super(messageFromBody(body, 'Conflict'), { status: 409, body });
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends ConfishError {
  readonly retryAfter: number | undefined;
  readonly limit: number | undefined;
  readonly remaining: number | undefined;

  constructor(body: unknown, headers: Headers) {
    super(messageFromBody(body, 'Rate limit exceeded'), { status: 429, body });
    this.name = 'RateLimitError';
    this.retryAfter = parseIntHeader(headers.get('retry-after'));
    this.limit = parseIntHeader(headers.get('x-ratelimit-limit'));
    this.remaining = parseIntHeader(headers.get('x-ratelimit-remaining'));
  }
}

export class ServerError extends ConfishError {
  constructor(status: number, body: unknown) {
    super(messageFromBody(body, `Server error (${status})`), { status, body });
    this.name = 'ServerError';
  }
}

export function errorFromResponse(status: number, body: unknown, headers: Headers): ConfishError {
  if (status === 401) return new AuthError(body);
  if (status === 403) return new ForbiddenError(body);
  if (status === 409) return new ConflictError(body);
  if (status === 422) return new ValidationError(body);
  if (status === 429) return new RateLimitError(body, headers);
  if (status >= 500) return new ServerError(status, body);
  return new ConfishError(messageFromBody(body, `Request failed (${status})`), { status, body });
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message;
  }
  return fallback;
}

function extractValidationErrors(body: unknown): Record<string, string[]> {
  if (
    body &&
    typeof body === 'object' &&
    'errors' in body &&
    body.errors &&
    typeof body.errors === 'object'
  ) {
    return body.errors as Record<string, string[]>;
  }
  return {};
}

function parseIntHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}
