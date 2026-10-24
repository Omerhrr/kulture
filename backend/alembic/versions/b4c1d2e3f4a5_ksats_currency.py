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


def upgrade() -> None:
    op.alter_column('shop_listings', 'price_ngn_minor', new_column_name='price_ksats',
                    existing_type=sa.BigInteger())
    op.alter_column('jobs', 'reward_ngn_minor', new_column_name='reward_ksats',
                    existing_type=sa.BigInteger())
    op.alter_column('work_shifts', 'paid_ngn_minor', new_column_name='paid_ksats',
                    existing_type=sa.BigInteger())
    with op.batch_alter_table('payment_intents') as batch:
        batch.alter_column('amount_ngn_minor', new_column_name='amount_ksats',
                           existing_type=sa.BigInteger())
        batch.alter_column('item_id', existing_type=sa.String(length=36), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('payment_intents') as batch:
        batch.alter_column('amount_ksats', new_column_name='amount_ngn_minor',
                           existing_type=sa.BigInteger())
        batch.alter_column('item_id', existing_type=sa.String(length=36), nullable=False)
    op.alter_column('work_shifts', 'paid_ksats', new_column_name='paid_ngn_minor',
                    existing_type=sa.BigInteger())
    op.alter_column('jobs', 'reward_ksats', new_column_name='reward_ngn_minor',
                    existing_type=sa.BigInteger())
    op.alter_column('shop_listings', 'price_ksats', new_column_name='price_ngn_minor',
                    existing_type=sa.BigInteger())
