import { Link } from "react-router-dom";

const VERIFIED_EVIDENCE = [
  {
    body: "Step through price, place simulated market, limit, and stop orders, then review your trades beside your notes and playbook rules.",
    title: "Practice with the full decision in view",
  },
  {
    body: "Your workspace is protected by Google sign-in. Saved sessions, notes, scripts, and chart layouts keep your work together between visits.",
    title: "Keep your process together",
  },
  {
    body: "Import market datasets and replay the sessions you want to study, at your own pace.",
    title: "Bring the market history you use",
  },
  {
    body: "Export your records, trade CSVs, and chart images with an active paid subscription.",
    title: "Keep a copy of your work",
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
              Every decision leaves a record.
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-7 text-edgelab-text-secondary sm:text-lg sm:leading-8">
              Keep the chart, the reason, and the result together. Return to the evidence
              when it is time to review your next session.
            </p>
          </div>
          <p className="text-sm leading-7 text-edgelab-text-secondary lg:border-l lg:border-edgelab-border lg:pl-8">
            Understand how your records are handled. Read the{" "}
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
              className="grid gap-4 border-b border-edgelab-border py-7 last:border-b-0 sm:grid-cols-[minmax(220px,0.7fr)_minmax(0,1fr)] sm:gap-10 sm:py-8"
              data-marketing-flow
              key={item.title}
            >
              <h3 className="text-xl font-medium leading-7 tracking-[-0.02em] text-edgelab-text-primary">
                {item.title}
              </h3>
              <p className="max-w-2xl text-sm leading-7 text-edgelab-text-secondary">
                {item.body}
              </p>
            </article>
          ))}
        </div>

      </div>
    </section>
  );
}
