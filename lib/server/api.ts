import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createMeta() {
  return {
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json(
    {
      success: true,
      data,
      meta: createMeta(),
    },
    { status },
  );
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
        meta: createMeta(),
      },
      { status: error.status },
    );
  }

  console.error(error);

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Unknown server error",
      },
      meta: createMeta(),
    },
    { status: 500 },
  );
}

export function assertNonEmptyString(value: unknown, code: string, message: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, code, message);
  }

  return value.trim();
}

export function parseInteger(value: string | null, fallback: number, options?: { min?: number; max?: number }) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  if (options?.min !== undefined && parsed < options.min) {
    return options.min;
  }

  if (options?.max !== undefined && parsed > options.max) {
    return options.max;
  }

  return parsed;
}

export async function readJsonBody<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch (error) {
    throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function readOptionalJsonBody<T>(request: Request, fallback: T) {
  const contentLength = request.headers.get("content-length");

  if (contentLength === "0") {
    return fallback;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return fallback;
  }

  return readJsonBody<T>(request);
}

export function getDefaultActorId() {
  return process.env.DEFAULT_ACTOR_ID ?? "system";
}

export function getDefaultGraphId() {
  return process.env.DEFAULT_GRAPH_ID ?? "default";
}

export async function runRoute<T>(executor: () => Promise<T>, status = 200) {
  try {
    const data = await executor();
    return successResponse(data, status);
  } catch (error) {
    return errorResponse(error);
  }
}
