# EdgeLab Scripts

## Overview
The `scripts` directory contains utility Node.js and Bash scripts for local development workflows and maintenance tasks.

## Responsibilities
- **Local Dev Orchestration**: The `dev.js` script provides a convenient way to launch the Node API, Python API, and Vite frontend in a single terminal.
- **Dependency Auditing**: Provides a shell script to run pip and npm vulnerability audits.
- **Cache Management**: A post-build script clears legacy Vite build caches.

## Directory Structure
- `dev.js` - A Node script that concurrently spawns `node backend/index.js`, `uvicorn app.main:app`, and `npm run dev` for the frontend.
- `audit-dependencies.sh` - Shell script running `pip-audit` and `npm audit`.
- `purge-vite-cache.js` - Script to clear stale Vite caches in `node_modules/.vite` during frontend builds.

## Local Development
To use the dev orchestrator:
```bash
node scripts/dev.js
```
*Note: Make sure your Python virtual environment has installed the required dependencies.*
