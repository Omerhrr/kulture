#!/usr/bin/env python3
"""Kaduna Kulture — restore a SQLite backup and verify its integrity.

Usage:
    python scripts/db_restore.py <backup.db> [target_db]

Safety:
- refuses to overwrite a non-empty target unless --force is given
- runs PRAGMA integrity_check and prints per-table row counts so the drill
  output doubles as the restore-verification record (docs/security.md)
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--force"]
    force = "--force" in sys.argv[1:]
    if len(args) < 1:
        print(__doc__, file=sys.stderr)
        return 2
    backup = Path(args[0])
    target = Path(args[1]) if len(args) > 1 else backup.parent.parent / "backend" / "kaduna.db"

    if not backup.exists():
        print(f"backup not found: {backup}", file=sys.stderr)
        return 2
    if target.exists() and target.stat().st_size > 0 and not force:
        print(
            f"refusing: {target} exists and is non-empty (pass --force to overwrite)",
            file=sys.stderr,
        )
        return 2

    # integrity check on the backup BEFORE touching the target
    chk = sqlite3.connect(str(backup))
    (result,) = chk.execute("PRAGMA integrity_check").fetchone()
    if result != "ok":
        print(f"BACKUP CORRUPT ({backup}): integrity_check -> {result}", file=sys.stderr)
        chk.close()
        return 1
    tables = [
        r[0]
        for r in chk.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
    ]
    chk.close()

    # copy + verify
    src = sqlite3.connect(str(backup))
    dst = sqlite3.connect(str(target))
    with dst:
        src.backup(dst)
    dst.close()
    src.close()

    ver = sqlite3.connect(str(target))
    print(f"restored {backup} -> {target}")
    print(f"integrity_check: ok ({len(tables)} tables)")
    for t in tables:
        n = ver.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]  # noqa: S608
        print(f"  {t:<24} {n:>8} rows")
    ver.close()
    print("restore drill: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
