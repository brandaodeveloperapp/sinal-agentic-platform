interface BrandMarkProps {
  size?: number;
  title?: string;
}

export function BrandMark({ size = 32, title = "Onda Telecom" }: BrandMarkProps) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id="onda-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand-from)" />
          <stop offset="100%" stopColor="var(--brand-to)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#onda-gradient)" />
      <path
        d="M6 20c2.6 0 2.6-8 5.2-8s2.6 8 5.2 8 2.6-8 5.2-8 2.6 8 5.2 8"
        fill="none"
        stroke="#fff"
        strokeWidth="2.1"
        strokeLinecap="round"
        opacity="0.95"
      />
    </svg>
  );
}
