import asyncio
import json
from uuid import UUID
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError
from loguru import logger

from app.core.security import decode_token
from app.ws.manager import manager

router = APIRouter(tags=["websocket"])

# room_id → background Redis subscriber task
_subscribers: dict[str, asyncio.Task] = {}


@router.websocket("/ws/notes/{note_id}")
async def note_websocket(
    note_id: UUID,
    ws: WebSocket,
    token: str = Query(..., description="JWT access token"),
) -> None:
    """
    WebSocket endpoint for real-time note collaboration with live presence.

    Binary frames   — raw Yjs document updates (stored + relayed)
    JSON frames     —
      awareness        relayed to peers + stored in Redis hash for late joiners
      ping             → pong
    Server-only:
      presence_sync    snapshot of all current awareness states, sent on join
      presence         user-id list broadcast on connect/disconnect
    """
    try:
        payload = decode_token(token)
        user_id: str = payload["sub"]
    except (JWTError, KeyError):
        await ws.close(code=4001, reason="Unauthorized")
        return

    room_id = str(note_id)
    await manager.connect(room_id, user_id, ws)

    # ── start cross-instance Redis subscriber once per room ───────────────────
    if room_id not in _subscribers or _subscribers[room_id].done():
        _subscribers[room_id] = asyncio.create_task(manager.subscribe(room_id))

    # ── replay Yjs document updates for the joining client ────────────────────
    stored_yjs = await manager.get_yjs_updates(room_id)
    for update in stored_yjs:
        try:
            await ws.send_bytes(update)
        except Exception:
            break

    # ── send presence snapshot so joiner sees who's already in the room ───────
    # Without this, new users have no awareness of existing peers' cursors and
    # status until those peers emit their next update.
    all_presence = await manager.get_all_presence(room_id)
    if all_presence:
        await ws.send_json({"type": "presence_sync", "states": all_presence})

    # ── broadcast updated user list to the whole room ─────────────────────────
    await manager.broadcast_json(
        room_id,
        {"type": "presence", "users": manager.get_user_ids(room_id)},
    )

    try:
        while True:
            msg = await ws.receive()

            # ws.receive() returns disconnect as a plain dict; re-raise so our
            # except block handles cleanup uniformly.
            if msg.get("type") == "websocket.disconnect":
                raise WebSocketDisconnect(msg.get("code", 1000))

            # ── binary: Yjs document update ───────────────────────────────────
            if "bytes" in msg and msg["bytes"] is not None:
                update: bytes = msg["bytes"]
                await asyncio.gather(
                    manager.broadcast_bytes(room_id, update, exclude=user_id),
                    manager.store_yjs_update(room_id, update),
                )

            # ── text / JSON ───────────────────────────────────────────────────
            elif "text" in msg and msg["text"] is not None:
                try:
                    data = json.loads(msg["text"])
                except Exception:
                    continue

                msg_type = data.get("type")

                if msg_type == "ping":
                    await ws.send_json({"type": "pong"})

                elif msg_type == "awareness":
                    # Persist each state entry to Redis so late joiners receive
                    # the full presence snapshot on their next connection.
                    for entry in data.get("states", []):
                        client_id = entry.get("clientId")
                        state = entry.get("state")
                        if client_id is not None and state:
                            await manager.store_presence(
                                room_id, user_id, client_id, state
                            )

                    # Relay awareness to all other peers in the room
                    await manager.broadcast_json(room_id, data, exclude=user_id)

                else:
                    logger.debug("ws unknown type={} room={}", msg_type, room_id)

    except WebSocketDisconnect:
        manager.disconnect(room_id, user_id)
        # Remove stale presence so future joiners don't see ghost users
        await manager.delete_presence(room_id, user_id)
        await manager.broadcast_json(
            room_id,
            {"type": "presence", "users": manager.get_user_ids(room_id)},
        )
