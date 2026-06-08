#!/bin/sh
set -eu

npm audit --audit-level=high
PYTHONPATH=backend backend/.venv/bin/python -m pip_audit -r backend/requirements.txt
