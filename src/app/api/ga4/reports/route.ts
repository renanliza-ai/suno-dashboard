import { getReportsByDimension } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Dim = "channel" | "sunoChannel" | "page" | "device" | "campaign";
const ALLOWED: Dim[] = ["channel", "sunoChannel", "page", "device", "campaign"];

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  if (!propertyId)
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });

  const dimRaw = req.nextUrl.searchParams.get("dim") || "channel";
  const dim: Dim = (ALLOWED.includes(dimRaw as Dim) ? dimRaw : "channel") as Dim;

  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");
  const { data, error } = await getReportsByDimension(propertyId, dim, days, startDate, endDate);
  if (error)
    return NextResponse.json(
      { propertyId, dim, error, rows: [], usedCustomDim: false },
      { status: 500 }
    );

  // anti race-condition: cliente valida que resposta é da property + dim atuais
  return NextResponse.json({ propertyId, dim, ...data }, {
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" },
  });
}
