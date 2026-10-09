type Capability = {
  description: string;
  name: string;
};

const CAPABILITIES: Capability[] = [
  {
    name: "Charts side by side",
    description: "Arrange and inspect as many as sixteen charts in one responsive workspace.",
  },
  {
    name: "Drawing tools within reach",
    description: "Mark levels and setups, and keep your favorite drawing tools close to the chart.",
  },
  {
    name: "Replay with order controls",
    description: "Step through a session and practice with simulated market, limit, and stop orders.",
  },
  {
    name: "Chart-integrated Journal",
    description: "Open active-symbol trade history and the review queue beside the chart, with review notes attached to each trade.",
  },
  {
    name: "Account comparison",
    description: "Compare two account scopes; monetary results remain in each account’s own currency.",
  },
  {
    name: "Custom indicators",
    description: "Add indicators from the library or run supported Pine scripts with your own inputs on loaded chart data.",
  },
];

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
              className="max-w-3xl landing-section-title text-edgelab-text-primary"
              data-marketing-reveal="capability-title"
              data-split-text="lines"
              id="capability-status-title"
            >
              Built for your trading day.
            </h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-edgelab-text-secondary sm:text-lg sm:leading-8 lg:justify-self-end">
            Replay, chart, journal, and review in one workspace.
          </p>
        </div>

        <div className="mt-14 border-y border-edgelab-border">
          {CAPABILITIES.map((capability) => (
            <article
              className="grid gap-4 border-b border-edgelab-border py-6 last:border-b-0 sm:grid-cols-[minmax(200px,0.72fr)_minmax(0,1fr)] sm:items-center sm:gap-8 sm:py-7"
              data-marketing-flow
              key={capability.name}
            >
              <h3 className="text-lg font-medium tracking-[-0.02em] text-edgelab-text-primary sm:text-xl">
                {capability.name}
              </h3>
              <p className="max-w-2xl text-sm leading-7 text-edgelab-text-secondary">
                {capability.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
