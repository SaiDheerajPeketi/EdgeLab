import { Check, Clock3 } from "lucide-react";
import { EdgePulseLoader } from "../EdgePulseLoader";
import { AuthJourneyShell } from "./AuthJourneyShell";

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
  panelEyebrow = "Secure handoff",
  panelTitle = "Authentication progress",
  statusLabel,
  steps,
  title,
}: AuthTransitionScreenProps) {
  const currentStep = Math.min(Math.max(activeStep, 0), Math.max(steps.length - 1, 0));
  const progress = steps.length === 0 ? 0 : ((currentStep + 1) / steps.length) * 100;

  return (
    <AuthJourneyShell
      description={description}
      rail={
        <div>
          <p className="text-sm font-medium text-cyan-100">{panelEyebrow}</p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.02em] text-edgelab-text-primary">
            {panelTitle}
          </h2>
          <div
            aria-label="Authentication progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={Math.round(progress)}
            className="mt-6 h-1.5 overflow-hidden rounded-full bg-edgelab-surface-2"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-edgelab-accent transition-[width] duration-500 ease-el-out motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
          <ol className="mt-7 grid gap-5">
            {steps.map((step, index) => {
              const isComplete = index < currentStep;
              const isActive = index === currentStep;
              const StepIcon = isComplete ? Check : Clock3;
              return (
                <li
                  aria-current={isActive ? "step" : undefined}
                  className="grid grid-cols-[32px_minmax(0,1fr)] gap-3"
                  key={step.label}
                >
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-full ${
                      isComplete
                        ? "bg-cyan-300/15 text-cyan-100"
                        : isActive
                          ? "bg-edgelab-accent text-ink-950"
                          : "bg-edgelab-surface-2 text-edgelab-text-muted"
                    }`}
                  >
                    <StepIcon aria-hidden="true" size={14} />
                  </span>
                  <span>
                    <strong className={`block text-sm font-medium ${isActive ? "text-edgelab-text-primary" : "text-edgelab-text-secondary"}`}>
                      {step.label}
                    </strong>
                    <span className="mt-1 block text-xs leading-5 text-edgelab-text-secondary">
                      {step.detail}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      }
      statusLabel={eyebrow || statusLabel}
      statusTone="accent"
      title={title}
    >
      <div className="flex items-center gap-4">
        <EdgePulseLoader label={statusLabel} showLabel size="lg" />
      </div>
    </AuthJourneyShell>
  );
}
