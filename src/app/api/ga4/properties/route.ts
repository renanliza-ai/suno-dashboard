import { listProperties } from "@/lib/ga4-server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await listProperties();
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ properties: data || [] });
}
