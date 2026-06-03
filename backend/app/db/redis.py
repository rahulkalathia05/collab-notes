from collections.abc import AsyncGenerator
import redis.asyncio as aioredis
from app.core.config import settings

_pool: aioredis.ConnectionPool | None = None


def get_pool() -> aioredis.ConnectionPool:
    global _pool
    if _pool is None:
        _pool = aioredis.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=20,
        )
    return _pool


async def get_redis() -> AsyncGenerator[aioredis.Redis, None]:
    client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
    try:
        yield client
    finally:
        await client.aclose()


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.aclose()
        _pool = None
