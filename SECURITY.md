# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities through a private GitHub security advisory for this repository. Do not put credentials, session tokens, customer records or exploit details in public issues. Include the affected commit, a minimal reproduction, likely impact and known mitigations. Maintainers should validate the report privately and publish remediation details after a fix is available; this policy does not promise a response-time SLA.

Security fixes target the current default branch. Operators must deploy a reviewed release and rotate any credential that may have been exposed. See [architecture](docs/architecture.md) for trust boundaries and [maintenance](docs/maintenance.md) for upgrades and recovery.

## Security-sensitive boundaries

- Identity and access: verified provider identity maps to an application tenant. Better Auth uses native origin/CSRF protections and fixed-key private introspection/revocation. Browser claims, route guards and numeric IDs do not authorize access. Production workspace access and exports use server-owned live entitlements; local bypass, beta identity and test checkout do not grant paid exports.
- Tenant data: every owned query, storage key, mutation, share and asynchronous publication must retain its account scope. Data replacement uses durable operation receipts and barriers; stale responses must not publish into a later account/session.
- Billing: validate Stripe webhook signatures and idempotent account/mode reconciliation. A success redirect is not payment proof. Secret keys and catalog authority stay server-side.
- Credentials: persisted integration secrets use authenticated encryption and the server keyring. Supported transient user-entered broker JWT/feed credentials can pass through browser memory and an authenticated first WebSocket message. Keep them out of URLs, telemetry, screenshots and shared data. All `VITE_*` values enter a public browser bundle and are not a secret store.
- Execution: native Pine runs through an opaque sandbox frame and isolated worker with restrictive CSP, owned identity/nonce, bounded validated messages and termination. These controls do not constitute a universal heap budget or proof of safety for future engine changes. Review engine upgrades and preserve source integrity checks.
- Files and proxy: dataset discovery is restricted to CSVs under the configured root. Keep mounts and uploads scoped. Private success/error responses remain `no-store`, including at any CDN. Do not expose database, Redis, introspection or monitoring ports to public clients.
- Telemetry: metrics use finite route/method labels; logs/traces redact query and bound values. Monitor services and the Docker API guard remain private. Alloy is a trusted scoped log reader; a Docker socket or permissive inspect proxy would breach this boundary. Never forward actual inspect environments or unsanitized exporters.

Use production HTTPS/WSS, strong distinct signing/service/vault/database credentials, narrowly scoped service access and controlled origins. Auth replicas must share a deliberately configured writer, schema and keys; test actual cross-replica logout. Review database/Redis access, backup encryption/access and failure domains for the chosen infrastructure. Local Compose's development keys/bypass are local preview defaults, not production configuration.

## Verification and audit coverage

Before a release run the baseline in [AGENTS.md](AGENTS.md) and the dependency audit:

```bash
rtk proxy sh scripts/audit-dependencies.sh
rtk npm run build
rtk proxy env PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
rtk npm test
rtk npm run check:docs
```

The audit script checks npm dependencies and Python **runtime** requirements. It does not scan every container/OS package or Python development dependency. The GitHub security-audit workflow has the same scope; operators must add image/OS and deployment-specific checks to their release process. Real Redis/PostgreSQL/auth-writer tests require the explicit disposable fixture URLs documented in [validation tiers](docs/maintenance.md#validation-tiers); skipped tests do not establish real-store coverage.

For a security-sensitive change, add the relevant authorization, owner-switch/replacement, malformed input, revocation, sandbox, webhook or telemetry privacy regression. Validate proxy/configuration and affected images. External provider activation, regional behavior and multi-node failover need their own evidence. Passing local checks does not establish a formal security certification.

## Incident and recovery handling

Contain exposure using the narrowest owned service/credential action, preserve private diagnostic evidence, rotate affected credentials and verify old credentials are rejected. Do not post secrets in logs or support tickets. Restore only from reviewed backups, with matching schema/image identity and a tested recovery path; returning to an older image does not undo a database migration. Follow the [rollback procedure](docs/maintenance.md#rollback-and-incidents) and [observability guide](docs/observability.md).
