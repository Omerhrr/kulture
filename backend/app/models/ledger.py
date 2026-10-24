"""Auditable simulated-economy ledger. Separation of asset classes is enforced
by convention: ``asset_type`` is one of ksats | reputation | item | sats_ref.

Real Bitcoin settlements are never recorded as spendable k-sats - they are
references to verified Lightning payments (asset_type="sats_ref").
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, BigInteger, String, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.base import UUIDPk, Timestamped


class GameLedgerEntry(UUIDPk, Timestamped, Base):
    __tablename__ = "game_ledger_entries"
    __table_args__ = (
        Index("ix_ledger_account", "account_reference"),
        Index("ix_ledger_asset", "asset_type"),
    )

    account_reference: Mapped[str] = mapped_column(String(128), nullable=False)
    # e.g. "player:<profile_id>" | "business:<id>" | "system"
    asset_type: Mapped[str] = mapped_column(String(24), nullable=False)
    amount_minor_units: Mapped[int] = mapped_column(BigInteger, nullable=False)  # signed
    transaction_reference: Mapped[str] = mapped_column(String(160), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(48), nullable=False)
    # job_reward | purchase_simulated | payment_settled_ref | reputation_gain | market_event | grant_initial
    description: Mapped[str] = mapped_column(String(256), default="")
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
