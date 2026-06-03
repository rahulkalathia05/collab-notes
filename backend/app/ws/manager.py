import json
from typing import Any
from fastapi import WebSocket
from loguru import logger
import redis.asyncio as aioredis

from app.db.redis import get_pool


class ConnectionManager:
    """
    In-process room registry. Redis pub/sub bridges messages across multiple
    server instances so horizontal scaling works without sticky sessions.
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

    # ── broadcast ─────────────────────────────────────────────────────────────

    async def broadcast(
        self,
        room_id: str,
        message: dict[str, Any],
        exclude: str | None = None,
    ) -> None:
        """Send to all connections in the room (in this process)."""
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

    # ── Redis pub/sub relay ───────────────────────────────────────────────────

    async def publish(self, room_id: str, message: dict[str, Any]) -> None:
        """Publish to Redis channel so other server instances receive it."""
        client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
        try:
            await client.publish(f"room:{room_id}", json.dumps(message))
        finally:
            await client.aclose()

    async def subscribe(self, room_id: str) -> None:
        """Subscribe to Redis channel and relay messages to local connections.

        Call in a background task per room (started on first WS join).
        """
        client: aioredis.Redis = aioredis.Redis(connection_pool=get_pool())
        pubsub = client.pubsub()
        await pubsub.subscribe(f"room:{room_id}")
        try:
            async for raw in pubsub.listen():
                if raw["type"] != "message":
                    continue
                try:
                    msg = json.loads(raw["data"])
                    await self.broadcast(room_id, msg)
                except Exception as exc:
                    logger.warning("pubsub relay error: {}", exc)
        finally:
            await pubsub.unsubscribe(f"room:{room_id}")
            await client.aclose()


manager = ConnectionManager()
