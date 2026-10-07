import { CheckCircle2, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";

const VERIFIED_EVIDENCE = [
  {
    body: "Manual bar replay, simulated market, limit, and stop orders, Journal records, reports, and playbooks are implemented in the current build.",
    title: "The core review loop is working product",
  },
  {
    body: "Google OAuth is the beta sign-in path. EdgeLab validates its own session and preserves an approved visitor’s intended workspace route.",
    title: "Access is gated and the return path is explicit",
  },
  {
    body: "Imported datasets are supported. Quant depends on configured models and permissions; footprint and TPO require qualified trade-level data. Candle-only feeds do not unlock order flow.",
    title: "Provider and roadmap boundaries stay visible",
  },
  {
    body: "Authenticated users can export EdgeLab app data as JSON. Large market-data files remain outside that application-data bundle.",
    title: "Beta data has a documented export path",
  },
] as const;

export function TrustEvidence({ id = "evidence" }: { id?: string }) {
  return (
    <section
      className="border-y border-edgelab-border bg-edgelab-base px-3 py-24 sm:px-6 sm:py-32 lg:px-8"
      id={id}
      tabIndex={-1}
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)] lg:items-end lg:gap-16">
          <div>
            <h2 className="max-w-4xl text-balance text-[clamp(2.6rem,6vw,5.6rem)] font-medium leading-[0.92] tracking-[-0.04em] text-edgelab-text-primary">
              What the current build can prove.
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-7 text-edgelab-text-secondary sm:text-lg sm:leading-8">
              Trust starts with a clear boundary between shipped behavior, beta policy, and work
              that is still planned.
            </p>
          </div>
          <p className="text-sm leading-7 text-edgelab-text-secondary lg:border-l lg:border-edgelab-border lg:pl-8">
            These statements are grounded in the current product and public beta policy. Read the{" "}
            <Link
              className="inline-flex min-h-11 items-center align-middle font-medium text-cyan-100 underline decoration-cyan-300/40 underline-offset-4 hover:decoration-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
              to="/privacy"
            >
              privacy summary
            </Link>
            {" "}for the data-handling context.
          </p>
        </div>

        <div className="mt-14 border-y border-edgelab-border">
          {VERIFIED_EVIDENCE.map((item) => (
            <article
              className="grid gap-4 border-b border-edgelab-border py-7 last:border-b-0 sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-8 sm:py-8"
              key={item.title}
            >
              <div className="flex items-center gap-2 self-start text-xs font-semibold text-cyan-100">
                <CheckCircle2 aria-hidden="true" size={16} />
                Verified in product
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1fr)] lg:gap-10">
                <h3 className="text-xl font-medium leading-7 tracking-[-0.02em] text-edgelab-text-primary">
                  {item.title}
                </h3>
                <p className="max-w-2xl text-sm leading-7 text-edgelab-text-secondary">
                  {item.body}
                </p>
              </div>
            </article>
          ))}
        </div>

        <div className="grid gap-4 border-b border-edgelab-border py-7 sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-8 sm:py-8">
          <div className="flex items-center gap-2 self-start text-xs font-semibold text-amber-100">
            <Clock3 aria-hidden="true" size={16} />
            Intentionally unpublished
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1fr)] lg:gap-10">
            <h3 className="text-xl font-medium leading-7 tracking-[-0.02em] text-edgelab-text-primary">
              External proof will appear only when it exists
            </h3>
            <p className="max-w-2xl text-sm leading-7 text-edgelab-text-secondary">
              EdgeLab does not publish invented testimonials, customer counts, return claims, or
              unsupported speed comparisons. Independent evidence and named customer stories remain
              placeholders until they can be verified.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
