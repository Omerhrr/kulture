"""Naive datetimes (SQLite drops tz) must serialise as UTC, never local time."""

from datetime import datetime

from pydantic import BaseModel

from app.schemas.utc import UTCDatetime


class _M(BaseModel):
    at: UTCDatetime


def test_naive_datetime_serialises_with_utc_offset():
    out = _M(at=datetime(2026, 10, 31, 9, 0, 0)).model_dump_json()
    assert '"2026-10-31T09:00:00Z"' in out
