"""UTC-aware datetime for API output.

SQLite stores DateTime(timezone=True) without the offset, so values come
back naive and would serialise without a "Z". Browsers then read them as
*local* time - in Lagos (UTC+1) every invoice looked an hour older and
showed as expired. All stored times are UTC, so naive means UTC.
"""

from datetime import datetime, timezone
from typing import Annotated

from pydantic import AfterValidator


def _as_utc(v: datetime) -> datetime:
    return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v


UTCDatetime = Annotated[datetime, AfterValidator(_as_utc)]
