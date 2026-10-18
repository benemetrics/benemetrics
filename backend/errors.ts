export class ApiError extends Error {
  constructor(
    public httpStatus: number,
    public message: string,
    public code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (entity: string, id: string) =>
  new ApiError(404, `${entity} not found: ${id}`, "NOT_FOUND");

export const badRequest = (msg: string) =>
  new ApiError(400, msg, "BAD_REQUEST");

export const unauthorized = (msg: string) =>
  new ApiError(401, msg, "UNAUTHORIZED");

export const forbidden = (msg: string) =>
  new ApiError(403, msg, "FORBIDDEN");

export const conflict = (msg: string) =>
  new ApiError(409, msg, "CONFLICT");

export const payloadTooLarge = (msg: string) =>
  new ApiError(413, msg, "PAYLOAD_TOO_LARGE");

export const internalError = (msg: string) =>
  new ApiError(500, msg, "INTERNAL_ERROR");

export const serviceUnavailable = (msg: string) =>
  new ApiError(503, msg, "SERVICE_UNAVAILABLE");

export const NO_READ_PERMISSION_MESSAGE = "No read permission. Provide admin token or valid OIDC identity.";