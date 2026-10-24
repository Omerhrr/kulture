"""k-sats currency

Rename the naira money columns to k-sats (the in-game currency, credited
1 k-sat per unit: deposits come in at 1 sat = 1,000 k-sats), and let a
payment intent have no item - a deposit intent isn't buying an item.

Revision ID: b4c1d2e3f4a5
Revises: a7a3b3f489eb
Create Date: 2026-10-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4c1d2e3f4a5'
down_revision: Union[str, None] = 'a7a3b3f489eb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The early migrations were later edited to create the k-sats names directly,
# so a fresh database already has them. Only rename what is still old.
RENAMES = [
    ('shop_listings', 'price_ngn_minor', 'price_ksats'),
    ('jobs', 'reward_ngn_minor', 'reward_ksats'),
    ('work_shifts', 'paid_ngn_minor', 'paid_ksats'),
    ('payment_intents', 'amount_ngn_minor', 'amount_ksats'),
]


def _cols(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _rename(table: str, old: str, new: str) -> None:
    cols = _cols(table)
    if old in cols and new not in cols:
        with op.batch_alter_table(table) as batch:
            batch.alter_column(old, new_column_name=new, existing_type=sa.BigInteger())


def upgrade() -> None:
    for table, old, new in RENAMES:
        _rename(table, old, new)
    with op.batch_alter_table('payment_intents') as batch:
        batch.alter_column('item_id', existing_type=sa.String(length=36), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('payment_intents') as batch:
        batch.alter_column('item_id', existing_type=sa.String(length=36), nullable=False)
    for table, old, new in reversed(RENAMES):
        _rename(table, new, old)
