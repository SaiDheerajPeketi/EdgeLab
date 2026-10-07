import { Check, Clock3 } from "lucide-react";

type CapabilityStatus = "available" | "data-required" | "provider-required" | "experimental" | "planned";

type Capability = {
  description: string;
  name: string;
  status: CapabilityStatus;
};

const CAPABILITIES: Capability[] = [
  {
    name: "4 × 4 chart grid",
    description: "Arrange and inspect as many as sixteen charts in one responsive workspace.",
    status: "available",
  },
  {
    name: "Circular chart toolbox",
    description: "Open a favorite drawing wheel from the active chart with Alt or Option.",
    status: "available",
  },
  {
    name: "Chart-integrated Journal",
    description: "Open active-symbol trade history and the review queue beside the chart, with review notes attached to each trade.",
    status: "available",
  },
  {
    name: "Footprint and TPO",
    description: "Read footprint and auction structure from qualified trade-level data. Candle-only feeds show an explicit unavailable state.",
    status: "data-required",
  },
  {
    name: "Account comparison",
    description: "Compare two account scopes; monetary results remain in each account’s own currency.",
    status: "available",
  },
  {
    name: "Quant assistant",
    description: "Explore chart-aware research and generated indicators with configured models, permissions, and consent for external requests.",
    status: "provider-required",
  },
  {
    name: "Native Pine scripts",
    description: "Run native Pine v5/v6 indicators and strategy orders on loaded chart data. PineTS support is experimental and results may differ from TradingView.",
    status: "experimental",
  },
];

const STATUS_COPY: Record<CapabilityStatus, string> = {
  available: "Available now",
  "data-required": "Qualified data required",
  "provider-required": "Provider dependent",
  experimental: "Experimental",
  planned: "Planned",
};

export function CapabilityStatusRail() {
  return (
    <section
      aria-labelledby="capability-status-title"
      className="px-3 py-24 sm:px-6 sm:py-32 lg:px-8"
      id="capabilities"
    >
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end">
          <div>
            <h2
              className="max-w-3xl text-balance text-[clamp(2.5rem,6vw,5.25rem)] font-medium leading-[0.92] tracking-[-0.04em] text-edgelab-text-primary"
              data-marketing-reveal="capability-title"
              data-split-text="lines"
              id="capability-status-title"
            >
              What ships now. What comes next.
            </h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-edgelab-text-secondary sm:text-lg sm:leading-8 lg:justify-self-end">
            Working tools, provider requirements, and future work are labelled separately.
            Check the data and access requirements before starting a session.
          </p>
        </div>

        <div className="mt-14 border-y border-edgelab-border">
          {CAPABILITIES.map((capability) => {
            const isAvailable = capability.status === "available";
            const StatusIcon = isAvailable ? Check : Clock3;

            return (
              <article
                className="grid gap-4 border-b border-edgelab-border py-6 last:border-b-0 sm:grid-cols-[160px_minmax(200px,0.72fr)_minmax(0,1fr)] sm:items-center sm:gap-8 sm:py-7"
                key={capability.name}
              >
                <div
                  className={`inline-flex w-fit items-center gap-2 text-xs font-semibold ${
                    isAvailable ? "text-cyan-200" : "text-amber-200"
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full ${
                      isAvailable ? "bg-cyan-300/15" : "bg-amber-300/15"
                    }`}
                  >
                    <StatusIcon aria-hidden="true" size={13} strokeWidth={2.4} />
                  </span>
                  {STATUS_COPY[capability.status]}
                </div>
                <h3 className="text-lg font-medium tracking-[-0.02em] text-edgelab-text-primary sm:text-xl">
                  {capability.name}
                </h3>
                <p className="max-w-2xl text-sm leading-7 text-edgelab-text-secondary">
                  {capability.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
