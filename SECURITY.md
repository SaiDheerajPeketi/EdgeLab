# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities through a private GitHub security advisory for this repository. Do not include credentials, session tokens, customer data, or exploit details in a public issue.

Include the affected version or commit, the smallest reproducible example, expected impact, and any known mitigations. Maintainers should acknowledge a complete report promptly, validate it privately, and publish remediation details after a fix is available.

## Supported version

Security fixes are applied to the current default branch. Deployments should update to its latest reviewed release and rotate any credential that may have been exposed.

## Local checks

Run the dependency audits and the normal verification suite before release:

```bash
sh scripts/audit-dependencies.sh
npm run build
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
npm test
```

The production proxy keeps observability metrics private, accepts session credentials for WebSockets only in the first message, and restricts dataset manifests to CSV files inside the configured dataset directory. Treat changes to those boundaries as security-sensitive.
