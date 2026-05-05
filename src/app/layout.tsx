import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { ChatProvider } from "@/lib/chat-context";
import { FloatingChat } from "@/components/floating-chat";
import { Sidebar } from "@/components/sidebar";
import { AuthProvider } from "@/components/auth-provider";
import { ShellFrame } from "@/components/shell-frame";
import { GA4Provider } from "@/lib/ga4-context";
import { GSCProvider } from "@/lib/gsc-context";

// Montserrat — fonte oficial do painel Suno. Carrega todos os pesos usados
// (300 regular, 400, 500, 600 medium, 700 bold, 800 extrabold) com fallback
// pra system-ui em caso de falha de rede.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Suno Analytics — Dashboard",
  description: "Insights em tempo real dos seus projetos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${montserrat.variable} antialiased`}>
      <body>
        <AuthProvider>
          <GA4Provider>
            <GSCProvider>
              <ChatProvider>
                <ShellFrame>{children}</ShellFrame>
              </ChatProvider>
            </GSCProvider>
          </GA4Provider>
        </AuthProvider>
      </body>
    </html>
  );
}
