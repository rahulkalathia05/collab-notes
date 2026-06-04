"""
Cache monitoring endpoint.

GET /api/v1/cache/stats   — per-type hit/miss counts + Redis server metrics
DELETE /api/v1/cache/flush — flush all application cache keys (admin only)

These endpoints are intentionally simple — they expose the counters written
by CacheClient._hit() / _miss() and key Redis INFO fields.  For production
observability, pipe the same data into Prometheus / Grafana via a metrics
exporter rather than polling this HTTP endpoint.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import CacheClient
from app.core.dependencies import get_current_user, get_db
from app.models.user import User

router = APIRouter(prefix="/cache", tags=["cache"])


@router.get("/stats")
async def cache_stats(
    current_user: User = Depends(get_current_user),
):
    """
    Return cache hit/miss counts per cache type and Redis memory metrics.

    Response shape:
    {
      "per_type": {
        "note":       {"hits": N, "misses": N, "total": N, "hit_rate": 0.92},
        "notes_list": {...},
        "workspace":  {...},
        "members":    {...},
        "membership": {...},
        "search":     {...}
      },
      "redis": {
        "used_memory_human": "2.5M",
        "cached_keys": 142,
        "keyspace_hits": 8421,
        "keyspace_misses": 312
      }
    }
    """
    cache = CacheClient()
    return await cache.get_stats()


@router.delete("/flush", status_code=204)
async def flush_cache(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Flush all application cache keys (cache:* namespace).
    Does NOT affect Yjs / presence / JWT blocklist keys.
    Requires authentication; only call from trusted admin tooling.
    """
    import redis.asyncio as aioredis
    from app.db.redis import get_pool

    client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
    try:
        cursor = 0
        deleted = 0
        while True:
            cursor, keys = await client.scan(cursor, match="cache:*", count=500)
            if keys:
                await client.delete(*keys)
                deleted += len(keys)
            if cursor == 0:
                break
    finally:
        await client.aclose()

    return {"deleted_keys": deleted}
