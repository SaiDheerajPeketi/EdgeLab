type EdgePulseLoaderProps = {
  className?: string;
  label?: string;
};

export function EdgePulseLoader({ className = "", label }: EdgePulseLoaderProps) {
  return (
    <div
      className={`inline-flex items-center gap-3 rounded-full border border-cyan-400/10 bg-[#08111a]/92 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/75 shadow-[0_14px_36px_rgba(0,0,0,0.26)] backdrop-blur-xl ${className}`}
    >
      <span aria-hidden="true" className="flex h-4 items-end gap-1">
        <span className="h-2 w-1 rounded-full bg-cyan-200/55 motion-safe:animate-[edgelab-loader-rise_1s_ease-in-out_infinite] motion-reduce:animate-none" />
        <span className="h-3.5 w-1 rounded-full bg-cyan-200/80 motion-safe:animate-[edgelab-loader-rise_1s_ease-in-out_140ms_infinite] motion-reduce:animate-none" />
        <span className="h-2.5 w-1 rounded-full bg-cyan-100/65 motion-safe:animate-[edgelab-loader-rise_1s_ease-in-out_280ms_infinite] motion-reduce:animate-none" />
      </span>
      {label ? <span>{label}</span> : null}
    </div>
  );
}
