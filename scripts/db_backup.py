#!/usr/bin/env python3
"""Kaduna Kulture — SQLite backup (online-safe via the sqlite3 backup API).

Usage:
    python scripts/db_backup.py [source_db] [dest_path]

Defaults: backend/kaduna.db -> backups/kaduna-YYYYmmdd-HHMMSS.db

For PostgreSQL deployments use pg_dump instead (see docker-compose.yml):
    pg_dump "$KK_DATABASE_URL" -Fc -f backups/kaduna-YYYYmmdd-HHMMSS.dump

Run this on a cron (e.g. hourly) and ship the backups/ directory off-box.
Restore drills: see docs/security.md -> "Backup & restore drill".
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import datetime
from pathlib import Path

BACKEND_DB = Path(__file__).resolve().parent.parent / "backend" / "kaduna.db"
BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"


def main() -> int:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else BACKEND_DB
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    dest = (
        Path(sys.argv[2])
        if len(sys.argv) > 2
        else BACKUP_DIR / f"kaduna-{datetime.now():%Y%m%d-%H%M%S}.db"
    )
    if source.resolve() == dest.resolve():
        print("refusing: destination equals source", file=sys.stderr)
        return 2
    if not source.exists():
        print(f"source database not found: {source}", file=sys.stderr)
        return 2

    src = sqlite3.connect(str(source))
    dst = sqlite3.connect(str(dest))
    with dst:
        src.backup(dst)  # online-safe: consistent snapshot while the game runs
    dst.close()
    src.close()

    size_kb = dest.stat().st_size / 1024
    print(f"backup written: {dest} ({size_kb:.1f} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
