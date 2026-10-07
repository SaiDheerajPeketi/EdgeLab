type EdgeLabMarkProps = {
  className?: string;
};

type EdgeLabWordmarkProps = {
  align?: "center" | "left";
  markFrame?: "bare" | "panel";
  showTagline?: boolean;
  size?: "hero" | "md" | "sm";
};

const WORDMARK_SIZE_STYLES = {
  hero: {
    gap: "gap-4 sm:gap-5",
    mark: "h-14 w-14 sm:h-16 sm:w-16",
    text: "text-[1.9rem] font-semibold leading-none sm:text-[2.4rem]",
    tagline: "mt-2 text-[11px] tracking-[0.18em] text-cyan-100/60",
  },
  md: {
    gap: "gap-3",
    mark: "h-11 w-11",
    text: "text-lg font-semibold leading-none",
    tagline: "mt-1.5 text-[10px] tracking-[0.16em] text-cyan-100/55",
  },
  sm: {
    gap: "gap-2.5",
    mark: "h-9 w-9",
    text: "text-base font-semibold leading-none",
    tagline: "mt-1 whitespace-nowrap text-[9px] tracking-[0.12em] text-cyan-100/55",
  },
} as const;

export function EdgeLabMark({ className = "" }: EdgeLabMarkProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      {/* EdgeLab's forward-cut E and grounded L. Keep these paths in sync with public brand exports. */}
      <path d="M7 10h34l-7 8H17v10h18l-7 8H17v10h24l-7 8H7Z" fill="#67e8f9" />
      <path d="M43 26h10v20h9l-7 8H43Z" fill="#f4f7fa" />
    </svg>
  );
}

export function EdgeLabWordmark({
  align = "left",
  markFrame = "panel",
  showTagline = true,
  size = "md",
}: EdgeLabWordmarkProps) {
  const styles = WORDMARK_SIZE_STYLES[size];
  const alignment = align === "center" ? "items-center text-center" : "items-start text-left";
  const markContainerClassName =
    markFrame === "panel"
      ? "relative grid shrink-0 place-items-center rounded-[1.35rem] border border-cyan-300/15 bg-white/[0.03] shadow-[0_16px_32px_rgba(0,0,0,0.22)]"
      : "relative grid shrink-0 place-items-center";

  return (
    <div className={`flex items-center ${styles.gap} text-slate-50`}>
      <div className={markContainerClassName}>
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
