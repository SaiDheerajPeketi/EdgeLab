# Contributing to EdgeLab

Read the [architecture](docs/architecture.md), [maintenance guide](docs/maintenance.md), and component README before changing a boundary. [AGENTS.md](AGENTS.md) defines agent workflow and invariants; [SECURITY.md](SECURITY.md) defines private vulnerability reporting. Do not publish customer records, credentials or private test artifacts in issues or PRs.

## Set up

Use Node.js 22.13+ and Python 3.12. Install the root npm workspace with `npm ci` and Python development requirements in `backend/.venv`. Follow [setup](docs/setup-and-deployment.md) for explicit database/auth/deployment settings; `.env.example` is a reference, not a production credential set. `npm run dev` does not load `.env` automatically.

## Make a focused change

1. Identify the owning route, service, model, browser state or runtime adapter. Preserve existing conventions and tenant identity across asynchronous work.
2. Make a small complete change; avoid unrelated formatting/refactors. Public availability states must reflect built capabilities and actual provider/data access.
3. Add a meaningful regression check for changed behavior. Do not add tests that merely duplicate implementation or for wording/comment changes.
4. Update the canonical documentation and all coupled configuration/build/source-offer inputs. Use the [change map](docs/maintenance.md#change-map).
5. Run the applicable [validation tier](docs/maintenance.md#validation-tiers); report skips and unverified provider/deployment behavior precisely.

Comments explain intent, ordering, ownership, units or external constraints. They should not narrate obvious syntax, promise unavailable behavior, contain credentials or accumulate stale TODO roadmaps. Separate a new architectural decision from an old measurement; significant boundary/storage changes need a short decision record under `docs/decisions/` following its template.

## Git workflow

Keep each feature or maintenance iteration separate. Inspect the working tree first and stage explicit paths; do not absorb another contributor's local edits, data, generated output or private artifacts. Prefer short intent-focused commit subjects. Use `codex/` for agent-created branches unless the user requests another name. Main should receive reviewed, validated work under the repository owner's chosen workflow; do not force-push to resolve divergence.

The optional `.githooks/post-commit` hook automatically pushes after a commit. Enabling it is a deliberate per-clone choice (`rtk git config --local core.hooksPath .githooks`), not an installation side effect. It can trigger remote CI. `CODEX_AUTO_PUSH=0` disables one intentional local-only commit. A failed push leaves the commit intact; fetch/review remote changes before retrying. Detached commits are preserved under `codex/preserve-detached-<commit>`.

Describe the concrete behavior, relevant validation, compatibility/data implications and real limitations in the [PR template](.github/PULL_REQUEST_TEMPLATE.md). Do not claim tests passed if they were skipped, unavailable or tested against a different checkout.

## Release-sensitive areas

Identity, billing/export access, account data replacement, persistent schema, source licenses, Pine sandboxing, live feed ownership and cache invalidation need review at their actual boundaries. Use disposable fixture stores for destructive migration/import/failover tests. Follow the [upgrade playbook](docs/maintenance.md) rather than replacing a volume, resetting a live checkout or pruning a shared Docker daemon.
