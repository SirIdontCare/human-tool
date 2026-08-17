import { NextResponse } from "next/server";
import { getCatalogueList } from "@/services/catalogue";
import { handleServiceError } from "@/lib/errors";

export async function GET() {
  try {
    const catalogue = await getCatalogueList();
    return NextResponse.json(catalogue, { status: 200 });
  } catch (err: unknown) {
    return handleServiceError(err);
  }
}
