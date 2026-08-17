import { NextResponse } from "next/server";
import { getCatalogueList } from "@/services/catalogue";
import { apiError, ServiceError } from "@/lib/errors";

export async function GET() {
  try {
    const catalogue = await getCatalogueList();
    return NextResponse.json(catalogue, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof ServiceError) {
      return apiError(err.message, err.code, err.status, err.details);
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
