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
    text: "text-[1.9rem] leading-none tracking-[-0.08em] sm:text-[2.4rem]",
    tagline: "mt-2 text-[11px] tracking-[0.3em] text-cyan-100/60",
  },
  md: {
    gap: "gap-3",
    mark: "h-11 w-11",
    text: "text-lg leading-none tracking-[-0.06em]",
    tagline: "mt-1.5 text-[10px] tracking-[0.26em] text-cyan-100/55",
  },
  sm: {
    gap: "gap-2.5",
    mark: "h-10 w-10",
    text: "text-base leading-none tracking-[-0.05em]",
    tagline: "mt-1 text-[10px] tracking-[0.22em] text-cyan-100/55",
  },
} as const;

export function EdgeLabMark({ className = "" }: EdgeLabMarkProps) {
  const gradientId = useId();

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 160 160"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="24" x2="126" y1="28" y2="118" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#34e2ff" />
          <stop offset="1" stopColor="#12b9e3" />
        </linearGradient>
      </defs>

      <path
        d="M42 30H123L105 50H56L47 65H97L80 84H47V98H86L69 117H29V61L42 30Z"
        fill={`url(#${gradientId})`}
      />
      <path d="M88 118L133 63H146L100 118H88Z" fill="#22d3ee" />
      <path d="M97 118L116 96V118H97Z" fill="#0f6d81" />
      <path d="M121 118V82L134 68V118H121Z" fill="#115b6e" />
      <path d="M140 118V55L153 42V118H140Z" fill="#16758c" />
      <path d="M139 36L153 23V31L129 49H126L139 36Z" fill="#f6b637" />
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
