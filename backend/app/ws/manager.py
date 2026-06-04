import asyncio
import json
from typing import Any
from fastapi import WebSocket
from loguru import logger
import redis.asyncio as aioredis

from app.db.redis import get_pool

# ── Redis key constants ────────────────────────────────────────────────────────

_YJS_KEY = "yjs:{room_id}"
_PRESENCE_KEY = "presence:{room_id}"

MAX_STORED_UPDATES = 200
YJS_KEY_TTL = 3600        # 1 hour
PRESENCE_KEY_TTL = 3600   # 1 hour — refreshed on every awareness update


class ConnectionManager:
    """
    In-process room registry. Redis pub/sub bridges messages across multiple
    server instances so horizontal scaling works without sticky sessions.

    Protocol
    ────────
    Binary frames  → Yjs document updates; stored in Redis list + relayed
    JSON frames    → awareness (stored in Redis hash + relayed),
                     presence_sync (sent to joiner), ping/pong
    """

    def __init__(self) -> None:
        # room_id → {user_id: WebSocket}
        self._rooms: dict[str, dict[str, WebSocket]] = {}

    # ── connection lifecycle ──────────────────────────────────────────────────

    async def connect(self, room_id: str, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._rooms.setdefault(room_id, {})[user_id] = ws
        logger.info("ws connect  room={} user={}", room_id, user_id)

    def disconnect(self, room_id: str, user_id: str) -> None:
        room = self._rooms.get(room_id, {})
        room.pop(user_id, None)
        if not room:
            self._rooms.pop(room_id, None)
        logger.info("ws disconnect room={} user={}", room_id, user_id)

    def get_user_ids(self, room_id: str) -> list[str]:
        return list(self._rooms.get(room_id, {}).keys())

    # ── Yjs update storage ────────────────────────────────────────────────────

    async def store_yjs_update(self, room_id: str, update: bytes) -> None:
        client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
        key = _YJS_KEY.format(room_id=room_id)
        try:
            pipe = client.pipeline()
            pipe.rpush(key, update)
            pipe.ltrim(key, -MAX_STORED_UPDATES, -1)
            pipe.expire(key, YJS_KEY_TTL)
            await pipe.execute()
        finally:
            await client.aclose()

    async def get_yjs_updates(self, room_id: str) -> list[bytes]:
        client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
        key = _YJS_KEY.format(room_id=room_id)
        try:
            updates = await client.lrange(key, 0, -1)
            return [bytes(u) for u in updates]
        finally:
            await client.aclose()

    # ── Presence state storage (Redis hash per room) ──────────────────────────
    #
    # Schema: HSET presence:{room_id}  {user_id}  JSON({clientId, state})
    #
    # Storing by user_id (JWT sub) keeps entries stable across reconnects and
    # allows the backend to delete cleanly on disconnect without knowing the
    # Yjs clientId. The `clientId` is embedded in the value so the frontend
    # can correctly populate the Awareness map on presence_sync.

    async def store_presence(
        self,
        room_id: str,
        user_id: str,
        client_id: int,
        state: dict[str, Any],
    ) -> None:
        client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
        key = _PRESENCE_KEY.format(room_id=room_id)
        try:
            payload = json.dumps({"clientId": client_id, "state": state})
            await client.hset(key, user_id, payload)
            await client.expire(key, PRESENCE_KEY_TTL)
        finally:
            await client.aclose()

    async def get_all_presence(self, room_id: str) -> dict[str, dict]:
        """Return {user_id: {clientId, state}} for all users in the room."""
        client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
        key = _PRESENCE_KEY.format(room_id=room_id)
        try:
            raw = await client.hgetall(key)
            return {
                uid.decode() if isinstance(uid, bytes) else uid: json.loads(v)
                for uid, v in raw.items()
            }
        finally:
            await client.aclose()

    async def delete_presence(self, room_id: str, user_id: str) -> None:
        client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
        key = _PRESENCE_KEY.format(room_id=room_id)
        try:
            await client.hdel(key, user_id)
        finally:
            await client.aclose()

    # ── broadcast ─────────────────────────────────────────────────────────────

    async def broadcast_bytes(
        self,
        room_id: str,
        data: bytes,
        exclude: str | None = None,
    ) -> None:
        dead: list[str] = []
        for uid, ws in list(self._rooms.get(room_id, {}).items()):
            if uid == exclude:
                continue
            try:
                await ws.send_bytes(data)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.disconnect(room_id, uid)

    async def broadcast_json(
        self,
        room_id: str,
        message: dict[str, Any],
        exclude: str | None = None,
    ) -> None:
        dead: list[str] = []
        for uid, ws in list(self._rooms.get(room_id, {}).items()):
            if uid == exclude:
                continue
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(uid)
        for uid in dead:
            self.disconnect(room_id, uid)

    # ── Redis pub/sub relay (cross-instance) ─────────────────────────────────

    async def publish(self, room_id: str, message: dict[str, Any]) -> None:
        client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
        try:
            await client.publish(f"room:{room_id}", json.dumps(message))
        finally:
            await client.aclose()

    async def subscribe(self, room_id: str) -> None:
        client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
        pubsub = client.pubsub()
        await pubsub.subscribe(f"room:{room_id}")
        try:
            async for raw in pubsub.listen():
                if raw["type"] != "message":
                    continue
                try:
                    msg = json.loads(raw["data"])
                    await self.broadcast_json(room_id, msg)
                except Exception as exc:
                    logger.warning("pubsub relay error: {}", exc)
        finally:
            await pubsub.unsubscribe(f"room:{room_id}")
            await client.aclose()


manager = ConnectionManager()
