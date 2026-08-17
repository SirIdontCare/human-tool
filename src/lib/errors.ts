import { NextResponse } from "next/server";

export type ErrorCode =
  | "QUOTE_EXPIRED"
  | "QUOTE_ALREADY_USED"
  | "TASK_NOT_FOUND"
  | "TASK_ALREADY_ACCEPTED"
  | "WORKER_NOT_AUTHORIZED"
  | "WORKER_CAPABILITY_REQUIRED"
  | "INVALID_STATE"
  | "RESULT_NOT_READY"
  | "RESULT_ALREADY_SUBMITTED"
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export class ServiceError extends Error {
  constructor(
    public override message: string,
    public code: ErrorCode,
    public status: number = 400,
    public details?: unknown
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function apiError(message: string, code: ErrorCode, status: number = 400, details?: unknown) {
  return NextResponse.json(
    {
      error: message,
      code,
      details,
    },
    { status }
  );
}
