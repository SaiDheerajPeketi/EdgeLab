import { ArrowRight } from "lucide-react";
import { EdgeLabWordmark } from "../marketing/MarketingShell";

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
        className="relative w-full max-w-5xl rounded-[34px] border border-white/10 bg-[#061018]/94 p-6 shadow-card backdrop-blur-xl sm:p-8 lg:p-10"
        role="status"
      >
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <EdgeLabWordmark showTagline={false} />

            <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/80">
              <span className="h-2 w-2 rounded-full bg-cyan-200/80 shadow-[0_0_18px_rgba(139,245,255,0.55)] motion-safe:animate-pulse" />
              {statusLabel}
            </div>

            <div className="mt-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-100/55">
              {eyebrow}
            </div>
            <h1 className="mt-3 max-w-2xl text-[clamp(2.6rem,6vw,4.7rem)] font-semibold leading-[0.92] tracking-[-0.07em] text-white">
              {title}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">
              {description}
            </p>
          </div>

          <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-black/20 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {panelEyebrow}
                </div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {panelTitle}
                </div>
              </div>
              <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-slate-300 sm:inline-flex">
                <span>{safeActiveStep + 1}</span>
                <ArrowRight size={12} />
                <span>{steps.length}</span>
              </div>
            </div>

            <div
              aria-hidden="true"
              className="mt-5 h-1 overflow-hidden rounded-full bg-white/[0.06]"
            >
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,rgba(139,245,255,0.18),rgba(139,245,255,0.85),rgba(246,194,107,0.78))] transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{
                  width: `${((safeActiveStep + 1) / Math.max(steps.length, 1)) * 100}%`,
                }}
              />
            </div>

            <div className="mt-5 grid gap-3">
              {steps.map((step, index) => {
                const isCurrent = index === safeActiveStep;
                const isComplete = index < safeActiveStep;

                return (
                  <div
                    className={`rounded-[22px] border px-4 py-4 transition-colors duration-200 ${
                      isCurrent
                        ? "border-cyan-300/20 bg-cyan-300/[0.08]"
                        : isComplete
                          ? "border-white/10 bg-white/[0.04]"
                          : "border-white/8 bg-black/20"
                    }`}
                    key={step.label}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-1 h-2.5 w-2.5 rounded-full ${
                          isCurrent
                            ? "bg-cyan-200 shadow-[0_0_18px_rgba(139,245,255,0.45)] motion-safe:animate-pulse"
                            : isComplete
                              ? "bg-amber-200"
                              : "bg-white/20"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{step.label}</div>
                        <div className="mt-1 text-sm leading-6 text-slate-400">{step.detail}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
