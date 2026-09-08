"use client";

import { Image as ImageIcon } from "lucide-react";
import { SpacesView } from "@/components/spaces-view";

export default function BannersPage() {
  return (
    <SpacesView
      kind="banner"
      title="Banners"
      icon={<ImageIcon size={20} className="text-white" />}
      subtitle="Desempenho por espaço de banner, separado por B.U. Cliques e conversão a jusante, porque CTR por criativa não é mensurável hoje."
    />
  );
}
