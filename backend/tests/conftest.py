from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from fakeredis import FakeAsyncRedis
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.dependencies import get_db, get_redis_dep
from app.main import app  # FastAPI instance — must be imported AFTER app.models to avoid shadowing
from app.models.base import Base
from app.models import User, Workspace, WorkspaceMember, Note, NoteVersion, Comment  # noqa: F401

TEST_DATABASE_URL = "sqlite+aiosqlite:///./test.db"


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db(test_engine) -> AsyncGenerator[AsyncSession, None]:
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def fake_redis() -> AsyncGenerator[FakeAsyncRedis, None]:
    """Isolated in-memory Redis — reset each test, no real Redis needed."""
    redis = FakeAsyncRedis()
    yield redis
    await redis.aclose()


@pytest_asyncio.fixture
async def client(
    db: AsyncSession,
    fake_redis: FakeAsyncRedis,
) -> AsyncGenerator[AsyncClient, None]:
    async def _db():
        yield db

    async def _redis():
        yield fake_redis

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_redis_dep] = _redis

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
