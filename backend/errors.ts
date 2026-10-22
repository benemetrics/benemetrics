export const ErrorCode = {
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export interface RateLimitPayload {
  /** Seconds the sender should wait before retrying. */
  retryAfter: number;
  /** The rate-limit categories the limit applies to. */
  categories: string;
  /** The scope the limit is keyed on: `key` or `project`. */
  scope: string;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  /** Set on a 429: the Sentry-compatible rate-limit metadata. */
  readonly rateLimit?: RateLimitPayload;

  constructor(code: ErrorCode, message: string, rateLimit?: RateLimitPayload) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.rateLimit = rateLimit;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(ErrorCode.BAD_REQUEST, message);
}

export function unauthorized(
  message = "Unauthorized - Admin authentication required",
): ApiError {
  return new ApiError(ErrorCode.UNAUTHORIZED, message);
}

export function forbidden(message: string): ApiError {
  return new ApiError(ErrorCode.FORBIDDEN, message);
}

export function notFound(entity: string, value?: string): ApiError {
  const suffix = value === undefined ? "" : `: ${value}`;
  return new ApiError(ErrorCode.NOT_FOUND, `${entity} not found${suffix}`);
}

export function conflict(message: string): ApiError {
  return new ApiError(ErrorCode.CONFLICT, message);
}

export function payloadTooLarge(message: string): ApiError {
  return new ApiError(ErrorCode.PAYLOAD_TOO_LARGE, message);
}

export function tooManyRequests(
  message: string,
  rateLimit: RateLimitPayload,
): ApiError {
  return new ApiError(ErrorCode.TOO_MANY_REQUESTS, message, rateLimit);
}

export function serviceUnavailable(message: string): ApiError {
  return new ApiError(ErrorCode.SERVICE_UNAVAILABLE, message);
}

export function internalError(message: string): ApiError {
  return new ApiError(ErrorCode.INTERNAL, message);
}
