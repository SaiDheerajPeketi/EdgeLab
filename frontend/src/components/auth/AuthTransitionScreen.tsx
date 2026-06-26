import { EdgeLabWordmark } from "../marketing/MarketingShell";
import { EdgePulseLoader } from "../EdgePulseLoader";

type AuthTransitionStep = {
  detail: string;
  label: string;
};

type AuthTransitionScreenProps = {
  activeStep?: number;
  description: string;
  eyebrow: string;
  panelEyebrow?: string;
  panelTitle?: string;
  statusLabel: string;
  steps: AuthTransitionStep[];
  title: string;
};

export function AuthTransitionScreen({
  activeStep = 0,
  description,
  eyebrow,
  panelEyebrow = "Session path",
  panelTitle = "Secure handoff in progress",
  statusLabel,
  steps,
  title,
}: AuthTransitionScreenProps) {
  const safeActiveStep = Math.min(Math.max(activeStep, 0), Math.max(steps.length - 1, 0));

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-edgelab-base px-4 py-8 text-edgelab-text-primary sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="edgelab-mesh absolute inset-x-[-12%] top-[-18rem] h-[40rem] opacity-65" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(50,211,238,0.13),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(245,158,11,0.08),transparent_18%),linear-gradient(180deg,#07090d_0%,#090b0f_42%,#05070a_100%)]" />
        <div className="edgelab-grid absolute inset-0 opacity-30" />
      </div>

      <div
        aria-live="polite"
        className="relative w-full max-w-xl rounded-[30px] border border-cyan-400/10 bg-[linear-gradient(180deg,rgba(6,15,24,0.96),rgba(5,10,16,0.94))] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:p-8"
        role="status"
      >
        <EdgeLabWordmark showTagline={false} />

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <div className="rounded-full border border-cyan-400/10 bg-cyan-300/[0.07] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-100/62">
            {eyebrow}
          </div>
          <EdgePulseLoader label={statusLabel} />
        </div>

        <div className="mt-6">
          <h1 className="text-[clamp(2rem,6vw,3rem)] font-semibold leading-[0.95] tracking-[-0.05em] text-white">
            {title}
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400 sm:text-base">
            {description}
          </p>
        </div>

        <div className="mt-6 rounded-[24px] border border-cyan-400/8 bg-[#08111a]/86 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                {panelEyebrow}
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-100">
                {panelTitle}
              </div>
            </div>
            <div className="rounded-full border border-cyan-400/10 bg-black/20 px-3 py-1 text-[11px] font-medium text-slate-300">
              {safeActiveStep + 1} / {steps.length}
            </div>
          </div>

          <div
            aria-hidden="true"
            className="mt-4 h-1 overflow-hidden rounded-full bg-slate-800/90"
          >
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(34,197,94,0.32),rgba(139,245,255,0.88),rgba(139,245,255,0.38))] transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{
                width: `${((safeActiveStep + 1) / Math.max(steps.length, 1)) * 100}%`,
              }}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {steps.map((step, index) => {
              const isCurrent = index === safeActiveStep;
              const isComplete = index < safeActiveStep;

              return (
                <div
                  className={`rounded-full border px-3 py-2 text-xs font-medium transition-colors duration-200 ${
                    isCurrent
                      ? "border-cyan-300/18 bg-cyan-300/[0.08] text-cyan-50"
                      : isComplete
                        ? "border-emerald-400/16 bg-emerald-400/[0.08] text-emerald-100"
                        : "border-cyan-400/8 bg-black/20 text-slate-400"
                  }`}
                  key={step.label}
                >
                  {step.label}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
