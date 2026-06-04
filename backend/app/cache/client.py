"""
CacheClient — thin, fault-tolerant Redis wrapper for application caching.

Design principles
─────────────────
* Every public method is wrapped in try/except — a Redis failure must never
  break a request; the caller falls back to the DB transparently.
* Uses the existing global connection pool (decode_responses=True is correct
  here since all cached values are JSON strings, never binary).
* Hit/miss counters are written with INCR so stats survive process restarts.
* Invalidation always deletes keys (never updates them in place) to prevent
  race conditions where a stale value overwrites a fresher one.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from uuid import UUID

import redis.asyncio as aioredis
from loguru import logger

from app.db.redis import get_pool
from app.cache.keys import (
    membership_key,
    members_key,
    note_key,
    notes_list_key,
    search_key,
    stat_key,
    workspace_key,
    workspace_meta_pattern,
)

# ── TTLs (seconds) ────────────────────────────────────────────────────────────

TTL_NOTE = 120          # 2 min — collaborative editing; short to bound staleness
TTL_NOTES_LIST = 60     # 1 min — changes on every edit / pin / create
TTL_WORKSPACE = 600     # 10 min — workspace metadata changes rarely
TTL_MEMBERS = 300       # 5 min — membership list rarely changes
TTL_MEMBERSHIP = 300    # 5 min — role rarely changes mid-session
TTL_SEARCH = 60         # 1 min — acceptable search staleness


# ── helpers ───────────────────────────────────────────────────────────────────

def _dumps(obj: dict | list) -> str:
    return json.dumps(obj, default=str)


def _loads(raw: str) -> dict | list:
    return json.loads(raw)


class CacheClient:
    """Per-request (or per-service) cache client. Stateless; safe to instantiate freely."""

    @asynccontextmanager
    async def _conn(self):
        """Yield a short-lived Redis client from the global pool."""
        client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
        try:
            yield client
        finally:
            await client.aclose()

    # ── hit/miss counters ─────────────────────────────────────────────────────

    async def _hit(self, cache_type: str) -> None:
        try:
            async with self._conn() as r:
                await r.incr(stat_key(cache_type, "hits"))
        except Exception:
            pass  # stats are best-effort

    async def _miss(self, cache_type: str) -> None:
        try:
            async with self._conn() as r:
                await r.incr(stat_key(cache_type, "misses"))
        except Exception:
            pass

    # ── note ─────────────────────────────────────────────────────────────────

    async def get_note(self, workspace_id: UUID | str, note_id: UUID | str) -> dict | None:
        try:
            async with self._conn() as r:
                raw = await r.get(note_key(workspace_id, note_id))
            if raw:
                await self._hit("note")
                return _loads(raw)
            await self._miss("note")
            return None
        except Exception:
            logger.debug("cache get_note error")
            return None

    async def set_note(self, workspace_id: UUID | str, note_id: UUID | str, data: dict) -> None:
        try:
            async with self._conn() as r:
                await r.setex(note_key(workspace_id, note_id), TTL_NOTE, _dumps(data))
        except Exception:
            logger.debug("cache set_note error")

    async def del_note(self, workspace_id: UUID | str, note_id: UUID | str) -> None:
        try:
            async with self._conn() as r:
                await r.delete(note_key(workspace_id, note_id))
        except Exception:
            logger.debug("cache del_note error")

    # ── note list ─────────────────────────────────────────────────────────────

    async def get_notes_list(self, workspace_id: UUID | str) -> list | None:
        try:
            async with self._conn() as r:
                raw = await r.get(notes_list_key(workspace_id))
            if raw:
                await self._hit("notes_list")
                return _loads(raw)
            await self._miss("notes_list")
            return None
        except Exception:
            logger.debug("cache get_notes_list error")
            return None

    async def set_notes_list(self, workspace_id: UUID | str, data: list) -> None:
        try:
            async with self._conn() as r:
                await r.setex(notes_list_key(workspace_id), TTL_NOTES_LIST, _dumps(data))
        except Exception:
            logger.debug("cache set_notes_list error")

    async def del_notes_list(self, workspace_id: UUID | str) -> None:
        try:
            async with self._conn() as r:
                await r.delete(notes_list_key(workspace_id))
        except Exception:
            logger.debug("cache del_notes_list error")

    # ── workspace metadata ────────────────────────────────────────────────────

    async def get_workspace(self, workspace_id: UUID | str, user_id: UUID | str) -> dict | None:
        try:
            async with self._conn() as r:
                raw = await r.get(workspace_key(workspace_id, user_id))
            if raw:
                await self._hit("workspace")
                return _loads(raw)
            await self._miss("workspace")
            return None
        except Exception:
            logger.debug("cache get_workspace error")
            return None

    async def set_workspace(
        self, workspace_id: UUID | str, user_id: UUID | str, data: dict
    ) -> None:
        try:
            async with self._conn() as r:
                await r.setex(workspace_key(workspace_id, user_id), TTL_WORKSPACE, _dumps(data))
        except Exception:
            logger.debug("cache set_workspace error")

    async def del_workspace_all(self, workspace_id: UUID | str) -> None:
        """Delete all per-user workspace metadata entries via cursor-based SCAN."""
        try:
            async with self._conn() as r:
                pattern = workspace_meta_pattern(workspace_id)
                cursor = 0
                while True:
                    cursor, keys = await r.scan(cursor, match=pattern, count=100)
                    if keys:
                        await r.delete(*keys)
                    if cursor == 0:
                        break
        except Exception:
            logger.debug("cache del_workspace_all error")

    # ── workspace members ─────────────────────────────────────────────────────

    async def get_members(self, workspace_id: UUID | str) -> list | None:
        try:
            async with self._conn() as r:
                raw = await r.get(members_key(workspace_id))
            if raw:
                await self._hit("members")
                return _loads(raw)
            await self._miss("members")
            return None
        except Exception:
            logger.debug("cache get_members error")
            return None

    async def set_members(self, workspace_id: UUID | str, data: list) -> None:
        try:
            async with self._conn() as r:
                await r.setex(members_key(workspace_id), TTL_MEMBERS, _dumps(data))
        except Exception:
            logger.debug("cache set_members error")

    async def del_members(self, workspace_id: UUID | str) -> None:
        try:
            async with self._conn() as r:
                await r.delete(members_key(workspace_id))
        except Exception:
            logger.debug("cache del_members error")

    # ── membership role ───────────────────────────────────────────────────────

    async def get_membership_role(
        self, workspace_id: UUID | str, user_id: UUID | str
    ) -> str | None:
        try:
            async with self._conn() as r:
                role = await r.get(membership_key(workspace_id, user_id))
            if role:
                await self._hit("membership")
                return role
            await self._miss("membership")
            return None
        except Exception:
            logger.debug("cache get_membership_role error")
            return None

    async def set_membership_role(
        self, workspace_id: UUID | str, user_id: UUID | str, role: str
    ) -> None:
        try:
            async with self._conn() as r:
                await r.setex(membership_key(workspace_id, user_id), TTL_MEMBERSHIP, role)
        except Exception:
            logger.debug("cache set_membership_role error")

    async def del_membership(
        self, workspace_id: UUID | str, user_id: UUID | str
    ) -> None:
        try:
            async with self._conn() as r:
                await r.delete(membership_key(workspace_id, user_id))
        except Exception:
            logger.debug("cache del_membership error")

    # ── search results ────────────────────────────────────────────────────────

    async def get_search(self, key: str) -> dict | None:
        try:
            async with self._conn() as r:
                raw = await r.get(key)
            if raw:
                await self._hit("search")
                return _loads(raw)
            await self._miss("search")
            return None
        except Exception:
            logger.debug("cache get_search error")
            return None

    async def set_search(self, key: str, data: dict) -> None:
        try:
            async with self._conn() as r:
                await r.setex(key, TTL_SEARCH, _dumps(data))
        except Exception:
            logger.debug("cache set_search error")

    # ── monitoring ────────────────────────────────────────────────────────────

    async def get_stats(self) -> dict:
        """
        Return cache stats: per-type hit/miss counts, derived hit rate,
        and key Redis server metrics (memory, keyspace).
        """
        _TYPES = ("note", "notes_list", "workspace", "members", "membership", "search")
        stats: dict = {"per_type": {}, "redis": {}}

        try:
            async with self._conn() as r:
                # Hit/miss counters per cache type
                keys = []
                for t in _TYPES:
                    keys.extend([stat_key(t, "hits"), stat_key(t, "misses")])
                values = await r.mget(*keys)

                for i, t in enumerate(_TYPES):
                    hits = int(values[i * 2] or 0)
                    misses = int(values[i * 2 + 1] or 0)
                    total = hits + misses
                    stats["per_type"][t] = {
                        "hits": hits,
                        "misses": misses,
                        "total": total,
                        "hit_rate": round(hits / total, 3) if total else 0.0,
                    }

                # Redis server info
                info = await r.info("memory")
                stats["redis"]["used_memory_human"] = info.get("used_memory_human")
                stats["redis"]["used_memory_rss_human"] = info.get("used_memory_rss_human")
                stats["redis"]["mem_fragmentation_ratio"] = info.get("mem_fragmentation_ratio")

                # Total cache key count (approximate — scans only cache:* namespace)
                count = 0
                cursor = 0
                while True:
                    cursor, chunk = await r.scan(cursor, match="cache:*", count=500)
                    count += len(chunk)
                    if cursor == 0:
                        break
                stats["redis"]["cached_keys"] = count

                # Keyspace hit/miss from Redis INFO stats (server-level)
                kinfo = await r.info("stats")
                stats["redis"]["keyspace_hits"] = kinfo.get("keyspace_hits")
                stats["redis"]["keyspace_misses"] = kinfo.get("keyspace_misses")

        except Exception:
            logger.debug("cache get_stats error")

        return stats

    # ── bulk invalidation helpers ─────────────────────────────────────────────

    async def invalidate_note(self, workspace_id: UUID | str, note_id: UUID | str) -> None:
        """Invalidate all caches affected by a note change."""
        async with self._conn() as r:
            await r.delete(
                note_key(workspace_id, note_id),
                notes_list_key(workspace_id),
            )

    async def invalidate_membership(
        self, workspace_id: UUID | str, user_id: UUID | str
    ) -> None:
        """Invalidate all membership-related caches for a specific user."""
        try:
            async with self._conn() as r:
                await r.delete(
                    membership_key(workspace_id, user_id),
                    workspace_key(workspace_id, user_id),
                    members_key(workspace_id),
                )
        except Exception:
            logger.debug("cache invalidate_membership error")
