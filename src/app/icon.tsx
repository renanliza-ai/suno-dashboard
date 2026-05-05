import { ImageResponse } from "next/og";

// App Router icon convention — gera o favicon a partir deste arquivo em build time.
// Substitui o favicon.ico legado com um ícone com a identidade da Suno (gradiente roxo + "S").
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #7c5cff 0%, #5b3dd4 100%)",
          borderRadius: 7,
          color: "white",
          fontSize: 22,
          fontWeight: 800,
          fontFamily: "system-ui, -apple-system, sans-serif",
          letterSpacing: -1,
        }}
      >
        S
      </div>
    ),
    { ...size }
  );
}
