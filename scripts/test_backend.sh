#!/usr/bin/env bash
# Run backend tests inside WSL (pytest against the local SQLite dev DB).
set -euo pipefail
cd "$(dirname "$0")/../backend"
if [ ! -x ".venv_wsl/bin/python" ]; then
  python3 -m venv .venv_wsl
  .venv_wsl/bin/pip install -q -r requirements.txt
fi
.venv_wsl/bin/python -m pytest -q 2>&1 | tail -n 25
