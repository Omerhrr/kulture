"""Database migrations at boot (Alembic owns the schema).

Three cases:
- brand-new database          -> `alembic upgrade head`
- Alembic-managed database    -> `alembic upgrade head` (applies new revisions)
- older dev database built by `create_all` (no alembic_version table) ->
  create any missing tables, add any missing columns (with their server
  defaults), then stamp it at head so future revisions apply normally.

Nothing is ever dropped, so money, relationships, towns and businesses
survive every upgrade.
"""

from __future__ import annotations

import logging
import os

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.core.config import settings

log = logging.getLogger("kk.migrate")
HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, "..", "..", "alembic.ini")


def _sync_url() -> str:
    return settings.database_url.replace("sqlite+aiosqlite", "sqlite").replace("postgresql+asyncpg", "postgresql+psycopg2")


def _cfg() -> Config:
    cfg = Config(INI)
    cfg.attributes["programmatic"] = True
    cfg.set_main_option("script_location", os.path.join(HERE, "..", "..", "alembic"))
    return cfg


def _patch_legacy(engine) -> int:
    """Bring a create_all database up to the current models without data loss."""
    from app.models import Base

    Base.metadata.create_all(engine)
    added = 0
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl_type = col.type.compile(dialect=engine.dialect)
                default = ""
                if col.server_default is not None:
                    default = f" DEFAULT {col.server_default.arg if isinstance(col.server_default.arg, str) else col.server_default.arg.text}"
                    if isinstance(col.server_default.arg, str) and not col.server_default.arg.lstrip("-").isdigit():
                        default = f" DEFAULT '{col.server_default.arg}'"
                null = "" if col.nullable or default else ""  # SQLite can't add NOT NULL without a default
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl_type}{default}{null}'))
                added += 1
                log.info("migrate: added column %s.%s", table.name, col.name)
    return added


def migrate() -> None:
    engine = create_engine(_sync_url())
    try:
        tables = set(inspect(engine).get_table_names())
        cfg = _cfg()
        if tables and "alembic_version" not in tables:
            n = _patch_legacy(engine)
            command.stamp(cfg, "head")
            log.info("migrate: legacy database adopted by Alembic (%d columns added)", n)
        command.upgrade(cfg, "head")
    finally:
        engine.dispose()
