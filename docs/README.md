# Documentation index

These are engineering/operator documents for the implemented repository. Code, validated configuration and migrations are authoritative. Historical evidence describes its recorded checkout and fixture, not an unconditional production guarantee.

## Learn the system

- [Architecture](architecture.md): service boundaries, state ownership, request/data flows, security, execution, scaling and tradeoffs.
- [Glossary](glossary.md): product and market terminology.
- [Frontend guide](../frontend/README.md) and [backend guide](../backend/README.md): entrypoints and development workflows.
- [Frontend feature reference](frontend-feature-reference.md): detailed implemented behavior and compatibility caveats retained outside the setup guide.
- [Reviewed Pine source](../frontend/vendor/pinets/README.md): provenance, patched engine semantics and upgrade-sensitive limits.

## Run and maintain

- [Setup and deployment](setup-and-deployment.md): native, local Compose, production and efficient configurations.
- [Configuration](configuration.md): environment ownership, defaults and runtime/build distinction.
- [API guide](api-reference.md): route families, auth, errors, streams and ownership.
- [Maintenance](maintenance.md): upgrades, migrations, backups, rollback and validation tiers.
- [Observability](observability.md): private collectors, metrics, redaction, alerts and retention.
- [Security policy](../SECURITY.md): reporting, trust boundaries and audit scope.
- [Deployment utilities](../deployment/README.md), [Docker guide](../docker/README.md), and [scripts](../scripts/README.md).
- [Stripe sandbox](stripe-sandbox.md): test-only payments and entitlement boundaries.

## Contribute and assess evidence

- [Architecture decisions](decisions/README.md): a reviewed record of significant boundary and operational choices.
- [Contributor guide](../CONTRIBUTING.md), [agent instructions](../AGENTS.md), and [PR template](../.github/PULL_REQUEST_TEMPLATE.md).
- [Production capacity](production-capacity.md) and [performance methodology](production-performance.md): measured workload/resource/latency boundaries.
- [Infrastructure economics and data feeds](unit-economics-and-data-feeds.md): paying-user revenue, explicit cost/margin assumptions, downside scenarios and commercial feed options.
- [Threaded load tools](../benchmarks/README.md) and [k6 tools](../benchmark/README.md).
- [UI quality contract](ui-quality-contract.md), [surface inventory](ui-surface-inventory.md), [design rules](../frontend/DESIGN.md), and [product principles](../frontend/PRODUCT.md).

UI inventory/certification JSON and reviewed visual baselines are executable evidence, not marketing copy. Update their owning checks with UI changes. Landing studies and local planning/export notes are design artifacts; they are not launch commitments or authoritative operating instructions. Never add internal plans to the application or its matching-source archive.

## Keep documentation current

Keep one canonical description per subject, link to it, and update source evidence when the behavior changes. Setup belongs in component READMEs; contracts and operating detail belong here; non-obvious invariants belong beside the relevant code. Do not append a change log to the root README. Run `npm run check:docs` to validate maintained local links, anchors and fenced blocks. External availability and factual correctness still require review.
