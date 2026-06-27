import { EdgePulseLoader } from "../EdgePulseLoader";
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
  description,
  statusLabel,
  title,
}: AuthTransitionScreenProps) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-edgelab-base px-4 py-8 text-edgelab-text-primary sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#07090d_0%,#05070a_100%)]" />
        <div className="edgelab-grid absolute inset-0 opacity-20" />
      </div>

      <div
        aria-live="polite"
        className="relative flex flex-col items-center gap-5 text-center"
        role="status"
      >
        <EdgeLabWordmark showTagline={false} />
        <EdgePulseLoader label={statusLabel} showLabel size="lg" />
        <div>
          <h1 className="text-xl font-semibold tracking-normal text-white sm:text-2xl">{title}</h1>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>
    </div>
  );
}
