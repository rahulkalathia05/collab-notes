import asyncio
from uuid import UUID
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError
from loguru import logger

from app.core.security import decode_token
from app.ws.manager import manager

router = APIRouter(tags=["websocket"])

# room_id → background subscriber task
_subscribers: dict[str, asyncio.Task] = {}


@router.websocket("/ws/notes/{note_id}")
async def note_websocket(
    note_id: UUID,
    ws: WebSocket,
    token: str = Query(..., description="JWT access token"),
) -> None:
    try:
        user_id = decode_token(token)
    except JWTError:
        await ws.close(code=4001, reason="Unauthorized")
        return

    room_id = str(note_id)
    await manager.connect(room_id, user_id, ws)

    # Start Redis subscriber for this room if not already running
    if room_id not in _subscribers or _subscribers[room_id].done():
        _subscribers[room_id] = asyncio.create_task(manager.subscribe(room_id))

    await manager.broadcast(
        room_id,
        {"type": "presence", "users": manager.get_user_ids(room_id)},
    )

    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")

            if msg_type == "ping":
                await ws.send_json({"type": "pong"})

            elif msg_type in ("yjs_update", "awareness"):
                # Relay to local connections and publish cross-instance
                await manager.broadcast(room_id, data, exclude=user_id)
                await manager.publish(room_id, data)

            else:
                logger.debug("ws unknown type={} room={}", msg_type, room_id)

    except WebSocketDisconnect:
        manager.disconnect(room_id, user_id)
        await manager.broadcast(
            room_id,
            {"type": "presence", "users": manager.get_user_ids(room_id)},
        )
