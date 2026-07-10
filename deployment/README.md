# EdgeLab Deployment

## Overview
The `deployment` directory contains scripts and configurations for managing the live deployment environment of EdgeLab. This includes capturing the remote server state, pushing OAuth secrets, and repairing live port conflicts.

## Responsibilities
- **Instance State Capture**: Pulls configuration dotfiles, cron jobs, and package manifests from the Ubuntu server.
- **Replay Script Generation**: Converts captured instance state into an executable bash script to rebuild identical instances.
- **Secrets Injection**: Safely pushes local Google OAuth secrets to the remote Jenkins/Docker host without committing them to source control.
- **Infrastructure Repair**: Resolves port conflicts (e.g., between Jenkins and EdgeLab Nginx) and manages SSL certificates.

## Architecture / How it fits into the system
This directory bridges local development and the remote Jenkins/Ubuntu pipeline. 
- Scripts like `push-google-oauth-secret.sh` send JSON credentials directly to the remote server.
- The `api` container mounts this directory (via `docker-compose.yml`) read-only at `/opt/edgelab/deployment` to safely read the injected `google-oauth-client.json` at runtime.

## Directory Structure (brief)
- `fetch-instance-config.sh` - Pulls the remote server state to `instance-snapshots/`.
- `generate-deployment-script.py` - Parses a snapshot to build `install-from-instance.sh`.
- `push-google-oauth-secret.sh` - Uploads OAuth JSON and updates `.env` on the server.
- `repair-live-deployment.sh` - Reconfigures Jenkins/Nginx ports and runs `certbot`.
- `instance-snapshots/` - Local storage for downloaded server state bundles (git-ignored).
- `*.json` - Placeholder or downloaded OAuth credentials (git-ignored).

## Configuration
These scripts use hardcoded defaults that may be overridden by environment variables internally.

| Environment Variable / Target | Purpose | Default |
| --- | --- | --- |
| `ISSUE_CERTS` | When set to `1`, triggers certbot during repair | `""` |
| `GOOGLE_CLIENT_SECRETS_FILE` | (API config) Path to read the injected JSON | `/opt/edgelab/deployment/google-oauth-client.json` |

## Dependencies
- **Bash & Python 3**: For running the sync and generation scripts.
- **SSH & Rsync**: Required for communicating with the remote Ubuntu instance.

## Local Development
To fetch the current state of the remote instance:
```bash
deployment/fetch-instance-config.sh
```

To sync a new Google OAuth JSON credential to the server:
```bash
# Ensure client_secret_*.json is in the deployment folder
bash deployment/push-google-oauth-secret.sh
```
