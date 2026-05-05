type Props = {
  size?: number;
  variant?: "mark" | "full";
  className?: string;
};

export function SunoLogo({ size = 32, variant = "mark", className = "" }: Props) {
  if (variant === "mark") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <rect width="40" height="40" rx="10" fill="#0a0a0a" />
        <path
          d="M13 10 C 9 14, 9 26, 13 30"
          stroke="#e11d2a"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M27 10 C 31 14, 31 26, 27 30"
          stroke="#e11d2a"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
        <text
          x="20"
          y="24.5"
          textAnchor="middle"
          fill="#ffffff"
          fontFamily="system-ui, -apple-system, sans-serif"
          fontSize="10.5"
          fontWeight="300"
          letterSpacing="0.5"
        >
          S
        </text>
      </svg>
    );
  }

  const w = size * 4.5;
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 180 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M40 6 C 28 14, 28 26, 40 34"
        stroke="#e11d2a"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M140 6 C 152 14, 152 26, 140 34"
        stroke="#e11d2a"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <text
        x="90"
        y="26"
        textAnchor="middle"
        fill="currentColor"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="18"
        fontWeight="300"
        letterSpacing="5"
      >
        SUNO
      </text>
    </svg>
  );
}
