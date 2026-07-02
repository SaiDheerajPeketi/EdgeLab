# EdgeLab Deployment Capture

This folder contains scripts for recreating the deployment shape from the Ubuntu instance at `ubuntu@150.136.235.179`.

## Fetch the Instance Snapshot

```bash
deployment/fetch-instance-config.sh
```

Defaults:

- SSH key: `~/.ssh/mykey`
- SSH target: `ubuntu@150.136.235.179`
- Output root: `deployment/instance-snapshots`

The fetcher stores the raw remote bundle and extracted files locally. It captures shell history, home deployment dotfiles, package manifests, services, crons, and deployment-oriented `/etc` configuration trees. It intentionally excludes private keys, password databases, TLS private keys, and runtime cache/log directories.

## Generate the Replay Script

```bash
deployment/generate-deployment-script.py deployment/instance-snapshots/<snapshot-dir>
```

This writes:

```text
deployment/install-from-instance.sh
```

The generated script installs discovered packages and includes guarded restore steps for fetched configuration files. Review the generated script before running it on a fresh host, especially if the original instance relied on secrets or provider-specific metadata that should not be committed.

## Sync Google OAuth Secret To Jenkins Host

To copy a local Google OAuth client JSON onto the Docker/Jenkins host and wire the runtime env file:

```bash
bash deployment/push-google-oauth-secret.sh
```

Defaults:

- SSH key: `~/.ssh/mykey`
- SSH target: `ubuntu@150.136.235.179`
- Deploy dir: `/home/peketi_20214004/EdgeLab`
- Remote secret path: `/home/peketi_20214004/EdgeLab/deployment/google-oauth-client.json`

The script uploads the first `deployment/client_secret_*.json` file it finds, rewrites `${DEPLOY_DIR}/.env` with:

```text
GOOGLE_CLIENT_SECRETS_FILE=/opt/edgelab/deployment/google-oauth-client.json
EDGELAB_BETA_MANUAL_ACCESS_ENABLED=0
```

Jenkins can then rebuild normally; Docker Compose mounts `./deployment` into the API container at `/opt/edgelab/deployment`.

## Repair a Live Instance Port Conflict

If Jenkins is already bound to `8080`, `docker compose up -d` cannot start the EdgeLab frontend because the frontend publishes `${FRONTEND_PORT:-8080}`. Run:

```bash
sudo bash deployment/repair-live-deployment.sh
```

The repair script moves Jenkins to `127.0.0.1:9090`, keeps EdgeLab on `127.0.0.1:8080`, writes Nginx reverse proxy sites for `edgelab.co.in` and `jenkins.edgelab.co.in`, opens HTTP/HTTPS firewall rules, and recreates the EdgeLab Compose services.

To issue certificates after DNS points at the instance:

```bash
sudo ISSUE_CERTS=1 bash deployment/repair-live-deployment.sh
```
