import { listGSCSites } from "@/lib/gsc-server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/seo/sites
 *
 * Lista as propriedades do Google Search Console que o usuário logado tem acesso.
 * Equivalente ao seletor de propriedades do GA4, mas pra GSC.
 *
 * IMPORTANTE: o e-mail logado precisa ter sido adicionado como usuário em
 * https://search.google.com/search-console > Configurações > Usuários e permissões.
 */
export async function GET() {
  const { data, error } = await listGSCSites();
  if (error) return NextResponse.json({ error, sites: [] }, { status: 401 });

  return NextResponse.json(
    { sites: data || [] },
    {
      headers: { "Cache-Control": "private, max-age=600, stale-while-revalidate=3600" },
    }
  );
}
