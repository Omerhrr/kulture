"""characters: look, name and the assigned life (background, dream, home)

Revision ID: a9b0c1d2e3f4
Revises: f8a9b0c1d2e3
Create Date: 2026-10-27 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a9b0c1d2e3f4'
down_revision: Union[str, None] = 'f8a9b0c1d2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'characters',
        sa.Column('player_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=32), nullable=False),
        sa.Column('look', sa.JSON(), nullable=True),
        sa.Column('birth', sa.String(length=16), nullable=False),
        sa.Column('dream', sa.String(length=16), nullable=False),
        sa.Column('home_area', sa.String(length=32), nullable=False),
        sa.Column('home_x', sa.Float(), nullable=False),
        sa.Column('home_z', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('player_id'),
    )


def downgrade() -> None:
    op.drop_table('characters')
