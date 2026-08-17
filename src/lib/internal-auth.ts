import { NextRequest } from "next/server";

/**
 * Internal-only gate for dev/ops endpoints. Fails closed: requires an
 * INTERNAL_DEV_SECRET to be configured AND an exact x-internal-key match.
 * There is no static/fallback secret.
 */
export function isInternalRequestAuthorized(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_DEV_SECRET;
  if (!secret) return false;
  return request.headers.get("x-internal-key") === secret;
}