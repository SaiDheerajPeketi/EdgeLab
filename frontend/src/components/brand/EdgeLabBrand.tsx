import { useId } from "react";

type EdgeLabMarkProps = {
  className?: string;
};

type EdgeLabWordmarkProps = {
  align?: "center" | "left";
  showTagline?: boolean;
  size?: "hero" | "md" | "sm";
};

const WORDMARK_SIZE_STYLES = {
  hero: {
    gap: "gap-4 sm:gap-5",
    mark: "h-14 w-14 sm:h-16 sm:w-16",
    text: "font-display text-[1.9rem] leading-none sm:text-[2.4rem]",
    tagline: "mt-2 text-[11px] tracking-[0.18em] text-cyan-100/60",
  },
  md: {
    gap: "gap-3",
    mark: "h-11 w-11",
    text: "font-display text-lg leading-none",
    tagline: "mt-1.5 text-[10px] tracking-[0.16em] text-cyan-100/55",
  },
  sm: {
    gap: "gap-2.5",
    mark: "h-9 w-9",
    text: "font-display text-base leading-none",
    tagline: "mt-1 whitespace-nowrap text-[9px] tracking-[0.12em] text-cyan-100/55",
  },
} as const;

export function EdgeLabMark({ className = "" }: EdgeLabMarkProps) {
  const eGradientId = useId();
  const labGradientId = useId();
  const lineGradientId = useId();

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 160 160"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={eGradientId} x1="30" x2="116" y1="30" y2="118" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id={labGradientId} x1="82" x2="152" y1="118" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id={lineGradientId} x1="82" x2="130" y1="102" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#cffafe" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>

      <path
        d="M47 27H121L105 47H60C53 47 49 51 48 58L45 70H100L84 89H40L37 102C35 111 40 117 49 117H88L72 136H39C20 136 10 122 15 103L27 52C31 36 37 27 47 27Z"
        fill={`url(#${eGradientId})`}
      />
      <path d="M49 64H96L81 82H45L49 64Z" fill="#061018" opacity="0.92" />
      <path d="M53 97H96L80 117H49L53 97Z" fill="#061018" opacity="0.92" />
      <path d="M83 136L124 82L139 60L126 116H151L136 136H83Z" fill={`url(#${labGradientId})`} />
      <path d="M92 136L102 112H119L113 136H92Z" fill="#bae6fd" opacity="0.95" />
      <path d="M120 136L132 88L143 74L136 136H120Z" fill="#7dd3fc" opacity="0.88" />
      <path
        d="M82 106L100 99L115 82L130 67"
        fill="none"
        stroke={`url(#${lineGradientId})`}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="5"
      />
      <circle cx="82" cy="106" fill="#e0f7ff" r="6" />
      <circle cx="100" cy="99" fill="#bff4ff" r="5.5" />
      <circle cx="115" cy="82" fill="#8eeaff" r="5.5" />
    </svg>
  );
}

export function EdgeLabWordmark({
  align = "left",
  showTagline = true,
  size = "md",
}: EdgeLabWordmarkProps) {
  const styles = WORDMARK_SIZE_STYLES[size];
  const alignment = align === "center" ? "items-center text-center" : "items-start text-left";

  return (
    <div className={`flex items-center ${styles.gap} text-slate-50`}>
      <div className="relative grid shrink-0 place-items-center rounded-[1.35rem] border border-cyan-300/15 bg-white/[0.03] shadow-[0_16px_32px_rgba(0,0,0,0.22)]">
        <EdgeLabMark className={styles.mark} />
      </div>
      <div className={`flex min-w-0 flex-col ${alignment}`}>
        <div className={`font-semibold ${styles.text}`}>
          <span className="text-white">Edge</span>
          <span className="text-cyan-300">Lab</span>
        </div>
        {showTagline ? (
          <div className={`font-semibold uppercase leading-[1.4] ${styles.tagline}`}>
            Your Edge Engineered
          </div>
        ) : null}
      </div>
    </div>
  );
}
