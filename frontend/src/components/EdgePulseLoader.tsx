type EdgePulseLoaderProps = {
  className?: string;
  label?: string;
};

export function EdgePulseLoader({ className = "", label }: EdgePulseLoaderProps) {
  return (
    <div
      aria-label={label ?? "Loading"}
      className={`inline-flex items-center gap-1.5 rounded-full bg-cyan-200/[0.06] px-2 py-1.5 ${className}`}
      role="status"
    >
      <span aria-hidden="true" className="flex h-3 items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-200/50 motion-safe:animate-[edgelab-loader-rise_1s_ease-in-out_infinite] motion-reduce:animate-none" />
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-100/75 motion-safe:animate-[edgelab-loader-rise_1s_ease-in-out_140ms_infinite] motion-reduce:animate-none" />
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-200/50 motion-safe:animate-[edgelab-loader-rise_1s_ease-in-out_280ms_infinite] motion-reduce:animate-none" />
      </span>
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}
