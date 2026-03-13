import type { ProxyErrorOptions } from "./types";

export class ProxyError extends Error {
  status: number;
  code: string;
  type: string;
  details?: unknown;

  constructor(message: string, options: ProxyErrorOptions) {
    super(message);
    this.name = "ProxyError";
    this.status = options.status;
    this.code = options.code;
    this.type = options.type || "invalid_request_error";
    this.details = options.details;
  }
}

export function jsonError(error: unknown, requestId: string): Response {
  if (error instanceof ProxyError) {
    return Response.json(
      {
        error: {
          message: error.message,
          type: error.type,
          code: error.code,
          request_id: requestId,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }

  console.error(`[${requestId}] unhandled_error`, error);

  return Response.json(
    {
      error: {
        message: "Internal proxy error",
        type: "server_error",
        code: "internal_error",
        request_id: requestId,
      },
    },
    { status: 500 },
  );
}
