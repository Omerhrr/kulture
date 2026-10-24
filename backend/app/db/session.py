"""Async SQLAlchemy engine / session management (SQLite locally, PostgreSQL in prod)."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings


class Base(DeclarativeBase):
    """Declarative base for all Kaduna Kulture models."""


def _make_engine():
    url = settings.database_url
    if url.startswith("sqlite"):
        kwargs: dict = {
            "connect_args": {"check_same_thread": False},
            "pool_pre_ping": True,
        }
        if settings.db_null_pool:
            kwargs["poolclass"] = NullPool
        return create_async_engine(url, **kwargs)
    if settings.db_null_pool:  # tests: connections never cross event loops
        return create_async_engine(url, poolclass=NullPool)
    return create_async_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20, pool_recycle=1800)


engine = _make_engine()

AsyncSessionLocal = async_sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an async session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
