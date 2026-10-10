# Deployment utilities

These are operator tools for the historical Jenkins/Ubuntu host. Normal application setup is in [setup and deployment](../docs/setup-and-deployment.md); release, backup and recovery procedures are in [maintenance](../docs/maintenance.md).

| File | Purpose |
| --- | --- |
| `fetch-instance-config.sh` | Capture host inventory and selected configuration into a local snapshot |
| `generate-deployment-script.py` | Generate a bootstrap/config-restore script from a captured snapshot |
| `install-from-instance.sh` | Checked-in snapshot-specific bootstrap example; review or regenerate before use |
| `push-google-oauth-secret.sh` | Upload Google client JSON and edit the remote deployment environment |
| `repair-live-deployment.sh` | Change the known Jenkins/Nginx ports, services, firewall rules and optional certificates |

## Capture and bootstrap a host

The fetch and upload tools default to a historical host and SSH key. Set the target and key explicitly:

```bash
SSH_TARGET=user@example.com SSH_KEY=/path/to/key \
  deployment/fetch-instance-config.sh
```

Snapshots are written below `deployment/instance-snapshots/`. The fetch tool excludes selected private-key/password files, but it **does not comprehensively redact secrets**: shell histories, npm/pip configuration, environment and service/job configuration can contain credentials. Keep snapshots and archives private and outside Git; review before sharing. They are host-configuration inventories, not application database backups.

```bash
python3 deployment/generate-deployment-script.py \
  deployment/instance-snapshots/<snapshot-directory> \
  --output /private/path/install-reviewed-host.sh
```

Without `--output`, generation overwrites `deployment/install-from-instance.sh`. Review the generated package/service lists and restore targets before running as root. Config restoration and service enablement have explicit opt-in controls in the generated script. This tooling is not a portable new-install or disaster-recovery guarantee.

## Upload Google OAuth credentials

Pass the client JSON as the first argument; the script does not use a local `GOOGLE_CLIENT_SECRETS_FILE` environment variable to select its input:

```bash
SSH_TARGET=user@example.com SSH_KEY=/path/to/key \
  DEPLOY_DIR=/absolute/path/EdgeLab PUBLIC_ORIGIN=https://your-domain.example \
  deployment/push-google-oauth-secret.sh /private/path/client_secret.json
```

This uploads `deployment/google-oauth-client.json`, sets its remote permissions to 600, and updates the remote `.env` with the credential path, public origin, callback and disabled manual beta access. Configure authorized Google origins/redirect URIs separately. Production Compose mounts `deployment/` read-only into API and auth; recreate affected services to apply environment changes. Verify the configured auth provider and callbacks using [configuration](../docs/configuration.md).

## Existing Jenkins deployment

The root [Jenkinsfile](../Jenkinsfile) fetches and hard-resets the live checkout, runs Compose `down`, performs Docker daemon-wide pruning, explicitly builds poolers/API/frontend, then starts the default split stack. Named volumes are preserved, but this is a downtime deployment and pruning can affect other projects on the same daemon. Its explicit build list omits auth; it has no in-pipeline test/readiness, backup or automatic rollback gate. It does not select the efficient overlay or optional monitoring profile. Adapt and review it before production use, and keep API/auth/browser releases synchronized.

`repair-live-deployment.sh` is also host-specific: it installs packages, changes Jenkins/systemd and Nginx configuration, may terminate Jenkins processes occupying the frontend port, updates firewall rules and recreates application services. `ISSUE_CERTS=1` invokes Certbot after DNS is ready. Review those actions and take configuration/data backups before running it as root. See [maintenance](../docs/maintenance.md) for upgrade and rollback requirements.
