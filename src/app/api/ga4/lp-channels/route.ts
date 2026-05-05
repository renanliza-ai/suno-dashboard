import { getLPChannels, type LPBreakdownDimension } from "@/lib/ga4-server";
import { NextRequest, NextResponse } from "next/server";

const VALID_DIMENSIONS: LPBreakdownDimension[] = [
  "channel",
  "sourceMedium",
  "source",
  "medium",
  "campaign",
  "deviceCategory",
  "country",
];

function normalizeDimension(input: unknown): LPBreakdownDimension {
  if (typeof input === "string" && VALID_DIMENSIONS.includes(input as LPBreakdownDimension)) {
    return input as LPBreakdownDimension;
  }
  return "channel";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/ga4/lp-channels
 *
 * Compara N landing pages × canais. Aceita URLs absolutas ou paths puros.
 *
 * Body (POST):
 * {
 *   "propertyId": "339551432",
 *   "urls": [
 *     "https://lp.statusinvest.com.br/cl/webinario-status-alpha/",
 *     "https://lp.statusinvest.com.br/cl/webinario-status-alpha-b",
 *     "/cl/webinario-status-alpha-c"
 *   ],
 *   "days": 30
 * }
 *
 * Response:
 * {
 *   "results": [
 *     {
 *       "url": "https://...",
 *       "matched": true,
 *       "totalUsers": 4280,
 *       "totalSessions": 5120,
 *       "byChannel": [
 *         { "channel": "Paid Search", "users": 1820, "sessions": 2240 },
 *         ...
 *       ]
 *     },
 *     ...
 *   ],
 *   "range": { "startDate": "...", "endDate": "..." }
 * }
 */
export async function POST(req: NextRequest) {
  let body: {
    propertyId?: string;
    urls?: string[];
    days?: number;
    startDate?: string;
    endDate?: string;
    breakdownDimension?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const propertyId = body.propertyId;
  const urls = Array.isArray(body.urls) ? body.urls.filter(Boolean) : [];
  const days = body.days || 30;
  const startDate = body.startDate || null;
  const endDate = body.endDate || null;
  const breakdownDimension = normalizeDimension(body.breakdownDimension);

  if (!propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (urls.length === 0) return NextResponse.json({ error: "urls array required" }, { status: 400 });
  if (urls.length > 20) return NextResponse.json({ error: "max 20 URLs per request" }, { status: 400 });

  const { data, error } = await getLPChannels(
    propertyId,
    urls,
    days,
    startDate,
    endDate,
    breakdownDimension
  );

  if (error) {
    return NextResponse.json({ error, results: [], breakdownDimension }, { status: 200 });
  }

  return NextResponse.json(
    { results: data || [], days, breakdownDimension },
    {
      headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=1800" },
    }
  );
}

// Suporte GET pra debug rápido — passa URLs encoded como query string
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const urlsParam = req.nextUrl.searchParams.get("urls"); // separadas por vírgula
  const days = Number(req.nextUrl.searchParams.get("days") || 30);
  const breakdownDimension = normalizeDimension(req.nextUrl.searchParams.get("breakdownDimension"));

  if (!propertyId || !urlsParam) {
    return NextResponse.json(
      { error: "propertyId and urls (comma-separated) required" },
      { status: 400 }
    );
  }
  const urls = urlsParam.split(",").map((u) => u.trim()).filter(Boolean);
  const { data, error } = await getLPChannels(propertyId, urls, days, null, null, breakdownDimension);
  if (error) return NextResponse.json({ error, results: [], breakdownDimension });
  return NextResponse.json({ results: data || [], days, breakdownDimension });
}
