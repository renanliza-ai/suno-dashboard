import { getConversionEvents, getJourneyFunnel } from "@/lib/ga4-server";
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
  const [conversions, funnel] = await Promise.all([
    getConversionEvents(propertyId, days, startDate, endDate),
    getJourneyFunnel(propertyId, days, startDate, endDate),
  ]);

  return NextResponse.json(
    {
      conversions: conversions.data,
      funnel: funnel.data,
      errors: { conversions: conversions.error, funnel: funnel.error },
    },
    {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=1800" },
    }
  );
}
