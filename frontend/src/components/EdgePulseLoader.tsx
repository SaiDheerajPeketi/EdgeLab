type EdgePulseLoaderProps = {
  className?: string;
  label?: string;
  labelClassName?: string;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
};

export function EdgePulseLoader({
  className = "",
  label = "Loading",
  labelClassName = "",
  showLabel = false,
  size = "md",
}: EdgePulseLoaderProps) {
  const sizeClassName =
    size === "lg" ? "h-8 w-8" : size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <div
      aria-label={label}
      className={`inline-flex items-center gap-2 ${className}`}
      role="status"
    >
      <span
        aria-hidden="true"
        className={`relative inline-block ${sizeClassName}`}
      >
        <span className="absolute inset-0 rounded-full border border-cyan-200/15" />
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-200/90 border-r-cyan-200/35 motion-safe:animate-spin motion-reduce:animate-none" />
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-100/85 shadow-[0_0_18px_rgba(139,245,255,0.42)]" />
      </span>
      <span className={showLabel ? `text-sm text-slate-300 ${labelClassName}` : "sr-only"}>
        {label}
      </span>
    </div>
  );
}
