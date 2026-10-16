// Shared API error vocabulary. Routes and DAOs throw these instead of
// building HTTP responses; the root Elysia onError (backend/index.ts) is
// the single place that maps them to an HTTP status and `{ error }` body.
export const ErrorCode = {
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
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
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
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

export function internalError(message: string): ApiError {
  return new ApiError(ErrorCode.INTERNAL, message);
}
