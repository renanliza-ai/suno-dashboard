"use client";

import { Zap } from "lucide-react";
import { SpacesView } from "@/components/spaces-view";

export default function PopUpsPage() {
  return (
    <SpacesView
      kind="popup"
      title="Pop-ups"
      icon={<Zap size={20} className="text-white" />}
      subtitle="Desempenho por espaço de pop-up, separado por B.U. Onde existe evento de exibição, o par exibição/clique aparece por página."
    />
  );
}
