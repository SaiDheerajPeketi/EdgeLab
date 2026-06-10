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

