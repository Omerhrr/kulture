"""k-sats ledger rows

The k-sats rename changed the ledger asset type from 'ngn_minor' to 'ksats'
but left existing rows behind, so every existing player's balance read 0.
Move those rows over (same units, so amounts are unchanged).

Revision ID: c5d6e7f8a9b0
Revises: b4c1d2e3f4a5
Create Date: 2026-10-23
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'c5d6e7f8a9b0'
down_revision: Union[str, None] = 'b4c1d2e3f4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE game_ledger_entries SET asset_type = 'ksats' WHERE asset_type = 'ngn_minor'")


def downgrade() -> None:
    op.execute("UPDATE game_ledger_entries SET asset_type = 'ngn_minor' WHERE asset_type = 'ksats'")
