type Props = {
  account: string;
  size?: number;
  className?: string;
};

export function AccountLogo({ account, size = 32, className = "" }: Props) {
  const key = account.toLowerCase().replace(/\s+/g, "");

  if (key.includes("statusinvest") || key === "status") {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" className={className}>
        <rect width="40" height="40" rx="10" fill="#ffffff" />
        <path d="M 20 4 A 16 16 0 0 1 36 20" stroke="#1d4f86" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M 4 20 A 16 16 0 0 1 20 4" stroke="#2cb5a5" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M 4 20 A 16 16 0 0 0 20 36" stroke="#2cb5a5" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M 20 36 A 16 16 0 0 0 36 20" stroke="#e87826" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <text x="20" y="18" textAnchor="middle" fill="#1d4f86" fontSize="6" fontWeight="700" fontFamily="Montserrat, system-ui, sans-serif">STATUS</text>
        <text x="20" y="25" textAnchor="middle" fill="#2cb5a5" fontSize="6" fontWeight="700" fontFamily="Montserrat, system-ui, sans-serif">INVEST</text>
      </svg>
    );
  }

  if (key.includes("consultoria")) {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" className={className}>
        <rect width="40" height="40" rx="10" fill="#0a0a0a" />
        <path d="M11 11 C 7 15, 7 25, 11 29" stroke="#e11d2a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M29 11 C 33 15, 33 25, 29 29" stroke="#e11d2a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <text x="20" y="18" textAnchor="middle" fill="#ffffff" fontSize="5.5" fontWeight="300" letterSpacing="0.5" fontFamily="Montserrat, system-ui, sans-serif">SUNO</text>
        <text x="20" y="26" textAnchor="middle" fill="#ffffff" fontSize="4.5" fontWeight="400" letterSpacing="0.5" fontFamily="Montserrat, system-ui, sans-serif">CONSULT</text>
      </svg>
    );
  }

  if (key.includes("asset")) {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" className={className}>
        <rect width="40" height="40" rx="10" fill="#ffffff" stroke="#eceaf4" strokeWidth="1" />
        <path d="M11 11 C 7 15, 7 25, 11 29" stroke="#e11d2a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M29 11 C 33 15, 33 25, 29 29" stroke="#e11d2a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <text x="20" y="18" textAnchor="middle" fill="#0a0a0a" fontSize="5.5" fontWeight="300" letterSpacing="0.8" fontFamily="Montserrat, system-ui, sans-serif">SUNO</text>
        <text x="20" y="26" textAnchor="middle" fill="#0a0a0a" fontSize="6" fontWeight="600" letterSpacing="0.8" fontFamily="Montserrat, system-ui, sans-serif">ASSET</text>
      </svg>
    );
  }

  if (key.includes("fundsexplorer") || key === "funds") {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" className={className}>
        <rect width="40" height="40" rx="10" fill="#ffffff" />
        <circle cx="20" cy="20" r="14" fill="#3eb6f0" />
        <path d="M 11 23 L 17 17 L 22 22 L 30 14" stroke="#ffffff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M 26 14 L 30 14 L 30 18" stroke="#ffffff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="20" y="32" textAnchor="middle" fill="#ffffff" fontSize="4.5" fontWeight="700" fontFamily="Montserrat, system-ui, sans-serif">FUNDS</text>
      </svg>
    );
  }

  if (key === "fiis") {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" className={className}>
        <rect width="40" height="40" rx="10" fill="#0a0a0a" />
        <rect x="10" y="14" width="3" height="16" fill="#dac98a" />
        <rect x="14" y="11" width="3" height="19" fill="#dac98a" />
        <rect x="18" y="16" width="3" height="14" fill="#dac98a" />
        <text x="28" y="25" textAnchor="middle" fill="#dac98a" fontSize="9" fontWeight="800" fontFamily="Montserrat, system-ui, sans-serif">f</text>
      </svg>
    );
  }

  if (key.includes("sunoresearch") || key === "suno") {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" className={className}>
        <rect width="40" height="40" rx="10" fill="#0a0a0a" />
        <path d="M13 10 C 9 14, 9 26, 13 30" stroke="#e11d2a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M27 10 C 31 14, 31 26, 27 30" stroke="#e11d2a" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <text x="20" y="24.5" textAnchor="middle" fill="#ffffff" fontSize="10.5" fontWeight="300" letterSpacing="0.5" fontFamily="Montserrat, system-ui, sans-serif">S</text>
      </svg>
    );
  }

  const colors: Record<string, string> = {
    agro20: "#16a34a",
    certifiquei: "#0ea5e9",
    elevenfinancial: "#1f2937",
    fiagro: "#84cc16",
    scanfii: "#8b5cf6",
    simpatio: "#f97316",
  };
  const bg = colors[key] || "#7c5cff";
  const initial = account.charAt(0).toUpperCase();

  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className}>
      <rect width="40" height="40" rx="10" fill={bg} />
      <text
        x="20"
        y="27"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="18"
        fontWeight="700"
        fontFamily="Montserrat, system-ui, sans-serif"
      >
        {initial}
      </text>
    </svg>
  );
}
