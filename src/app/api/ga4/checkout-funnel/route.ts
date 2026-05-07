import { getCheckoutFunnel } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId)
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });

  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");
  const result = await getCheckoutFunnel(propertyId, days, startDate, endDate);

  return NextResponse.json(
    {
      data: result.data,
      error: result.error,
    },
    {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=1800" },
    }
  );
}
