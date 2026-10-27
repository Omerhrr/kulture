"""story progress

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-10-27 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd6e7f8a9b0c1'
down_revision: Union[str, None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'story_progress',
        sa.Column('player_id', sa.String(length=36), nullable=False),
        sa.Column('chapter', sa.Integer(), server_default='0', nullable=False),
        sa.Column('started', sa.Boolean(), server_default='0', nullable=False),
        sa.Column('job_id', sa.String(length=36), nullable=True),
        sa.Column('log', sa.JSON(), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('player_id'),
    )


def downgrade() -> None:
    op.drop_table('story_progress')
