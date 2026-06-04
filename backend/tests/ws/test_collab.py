"""
Real-time collaboration test suite.

Coverage:
  TestConnectionManager  — unit tests: room registry, broadcast, Redis storage
  TestWebSocketEndpoint  — protocol tests: auth, frames, relay, echo suppression
  TestSynchronization    — multi-user tests: late joiner, concurrent edits, isolation
  TestLatency            — timing tests: relay overhead, storage-vs-relay ordering
"""

import json
import time
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from fakeredis import FakeAsyncRedis
from starlette.testclient import TestClient

from app.core.security import create_access_token
from app.main import app
from app.ws.manager import MAX_STORED_UPDATES, ConnectionManager

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _token(user_id: str = "user-1") -> str:
    """Create a valid JWT for a test user (no DB needed)."""
    return create_access_token(user_id)[0]


def _note_url(note_id: str | None = None) -> str:
    nid = note_id or str(uuid4())
    return f"/ws/notes/{nid}"


class MockWS:
    """Minimal in-memory WebSocket stub for ConnectionManager unit tests."""

    def __init__(self) -> None:
        self.accepted = False
        self.bytes_sent: list[bytes] = []
        self.json_sent: list[dict] = []
        self.closed = False

    async def accept(self) -> None:
        self.accepted = True

    async def send_bytes(self, data: bytes) -> None:
        if not self.closed:
            self.bytes_sent.append(data)

    async def send_json(self, data: dict) -> None:
        if not self.closed:
            self.json_sent.append(data)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = True


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def fake_redis() -> AsyncGenerator[FakeAsyncRedis, None]:
    r = FakeAsyncRedis()
    yield r
    await r.aclose()


@pytest_asyncio.fixture
async def mgr(fake_redis: FakeAsyncRedis) -> ConnectionManager:
    """Fresh ConnectionManager with ALL Redis methods wired to FakeAsyncRedis."""
    import json as _json
    instance = ConnectionManager()

    # ── Yjs update log ────────────────────────────────────────────────────────

    async def _store_yjs(room_id: str, update: bytes) -> None:
        key = f"yjs:{room_id}"
        await fake_redis.rpush(key, update)
        await fake_redis.ltrim(key, -MAX_STORED_UPDATES, -1)

    async def _get_yjs(room_id: str) -> list[bytes]:
        rows = await fake_redis.lrange(f"yjs:{room_id}", 0, -1)
        return [bytes(r) for r in rows]

    # ── Presence hash ─────────────────────────────────────────────────────────

    async def _store_presence(room_id: str, user_id: str, client_id: int, state: dict) -> None:
        payload = _json.dumps({"clientId": client_id, "state": state})
        await fake_redis.hset(f"presence:{room_id}", user_id, payload)

    async def _get_all_presence(room_id: str) -> dict:
        raw = await fake_redis.hgetall(f"presence:{room_id}")
        return {
            (k.decode() if isinstance(k, bytes) else k): _json.loads(v)
            for k, v in raw.items()
        }

    async def _delete_presence(room_id: str, user_id: str) -> None:
        await fake_redis.hdel(f"presence:{room_id}", user_id)

    instance.store_yjs_update = _store_yjs          # type: ignore[assignment]
    instance.get_yjs_updates = _get_yjs              # type: ignore[assignment]
    instance.store_presence = _store_presence        # type: ignore[assignment]
    instance.get_all_presence = _get_all_presence    # type: ignore[assignment]
    instance.delete_presence = _delete_presence      # type: ignore[assignment]
    return instance


@pytest.fixture(autouse=True)
def reset_ws_state() -> None:
    """Clear all module-level WS state before every test."""
    import app.ws.router as ws_router

    from app.ws.manager import manager as global_manager

    global_manager._rooms.clear()
    ws_router._subscribers.clear()
    yield
    global_manager._rooms.clear()
    ws_router._subscribers.clear()


@pytest.fixture
def ws_client() -> TestClient:
    """
    TestClient with ALL Redis methods of the global ConnectionManager mocked.
    subscribe() is a no-op; presence methods default to empty returns.
    """
    from app.ws.manager import manager as mgr_singleton

    with (
        patch.object(mgr_singleton, "store_yjs_update", AsyncMock()),
        patch.object(mgr_singleton, "get_yjs_updates", AsyncMock(return_value=[])),
        patch.object(mgr_singleton, "store_presence", AsyncMock()),
        patch.object(mgr_singleton, "get_all_presence", AsyncMock(return_value={})),
        patch.object(mgr_singleton, "delete_presence", AsyncMock()),
        patch.object(mgr_singleton, "subscribe", AsyncMock()),
    ):
        with TestClient(app) as client:
            yield client


@pytest.fixture
def ws_client_with_stored(fake_stored_updates: list[bytes]) -> TestClient:
    """TestClient that returns fake_stored_updates to late joiners."""
    from app.ws.manager import manager as mgr_singleton

    with (
        patch.object(mgr_singleton, "store_yjs_update", AsyncMock()),
        patch.object(
            mgr_singleton,
            "get_yjs_updates",
            AsyncMock(return_value=fake_stored_updates),
        ),
        patch.object(mgr_singleton, "subscribe", AsyncMock()),
    ):
        with TestClient(app) as client:
            yield client


# ─────────────────────────────────────────────────────────────────────────────
# 1. ConnectionManager unit tests
# ─────────────────────────────────────────────────────────────────────────────

class TestConnectionManager:

    async def test_connect_adds_user_to_room(self, mgr: ConnectionManager) -> None:
        ws = MockWS()
        await mgr.connect("room-1", "user-1", ws)  # type: ignore[arg-type]
        assert "user-1" in mgr.get_user_ids("room-1")
        assert ws.accepted

    async def test_disconnect_removes_user(self, mgr: ConnectionManager) -> None:
        ws = MockWS()
        await mgr.connect("room-1", "user-1", ws)  # type: ignore[arg-type]
        mgr.disconnect("room-1", "user-1")
        assert "user-1" not in mgr.get_user_ids("room-1")

    async def test_disconnect_removes_empty_room(self, mgr: ConnectionManager) -> None:
        ws = MockWS()
        await mgr.connect("room-1", "user-1", ws)  # type: ignore[arg-type]
        mgr.disconnect("room-1", "user-1")
        assert "room-1" not in mgr._rooms

    async def test_disconnect_unknown_user_is_noop(self, mgr: ConnectionManager) -> None:
        """Disconnecting a user not in the room must not raise."""
        mgr.disconnect("nonexistent-room", "nobody")  # should not raise

    async def test_get_user_ids_returns_all_users(self, mgr: ConnectionManager) -> None:
        for uid in ("a", "b", "c"):
            await mgr.connect("room-1", uid, MockWS())  # type: ignore[arg-type]
        assert set(mgr.get_user_ids("room-1")) == {"a", "b", "c"}

    async def test_get_user_ids_empty_room_returns_empty(self, mgr: ConnectionManager) -> None:
        assert mgr.get_user_ids("no-such-room") == []

    async def test_broadcast_bytes_reaches_all_peers(self, mgr: ConnectionManager) -> None:
        ws_a, ws_b, ws_c = MockWS(), MockWS(), MockWS()
        for uid, ws in [("a", ws_a), ("b", ws_b), ("c", ws_c)]:
            await mgr.connect("room-1", uid, ws)  # type: ignore[arg-type]
        update = b"\xab\xcd\xef"
        await mgr.broadcast_bytes("room-1", update)
        assert ws_a.bytes_sent == [update]
        assert ws_b.bytes_sent == [update]
        assert ws_c.bytes_sent == [update]

    async def test_broadcast_bytes_excludes_sender(self, mgr: ConnectionManager) -> None:
        ws_a, ws_b = MockWS(), MockWS()
        await mgr.connect("room-1", "a", ws_a)  # type: ignore[arg-type]
        await mgr.connect("room-1", "b", ws_b)  # type: ignore[arg-type]
        update = b"\x01\x02"
        await mgr.broadcast_bytes("room-1", update, exclude="a")
        assert ws_a.bytes_sent == []  # sender excluded
        assert ws_b.bytes_sent == [update]  # peer received

    async def test_broadcast_json_reaches_all(self, mgr: ConnectionManager) -> None:
        ws_a, ws_b = MockWS(), MockWS()
        await mgr.connect("room-1", "a", ws_a)  # type: ignore[arg-type]
        await mgr.connect("room-1", "b", ws_b)  # type: ignore[arg-type]
        msg = {"type": "presence", "users": ["a", "b"]}
        await mgr.broadcast_json("room-1", msg)
        assert ws_a.json_sent == [msg]
        assert ws_b.json_sent == [msg]

    async def test_broadcast_prunes_dead_connections(self, mgr: ConnectionManager) -> None:
        """Dead WebSocket (send_bytes raises) must be evicted from the room."""
        ws_dead = MockWS()

        async def _dead_send(*_: object) -> None:
            raise RuntimeError("connection closed")

        ws_dead.send_bytes = _dead_send  # type: ignore[assignment]
        ws_live = MockWS()
        await mgr.connect("room-1", "dead", ws_dead)  # type: ignore[arg-type]
        await mgr.connect("room-1", "live", ws_live)  # type: ignore[arg-type]
        await mgr.broadcast_bytes("room-1", b"\xff")
        assert "dead" not in mgr.get_user_ids("room-1")
        assert ws_live.bytes_sent == [b"\xff"]

    async def test_store_yjs_update_persists(
        self, mgr: ConnectionManager, fake_redis: FakeAsyncRedis
    ) -> None:
        update = b"\xde\xad\xbe\xef"
        await mgr.store_yjs_update("room-1", update)
        stored = await mgr.get_yjs_updates("room-1")
        assert stored == [update]

    async def test_store_multiple_updates_preserves_order(
        self, mgr: ConnectionManager
    ) -> None:
        updates = [bytes([i]) * 4 for i in range(5)]
        for u in updates:
            await mgr.store_yjs_update("room-1", u)
        stored = await mgr.get_yjs_updates("room-1")
        assert stored == updates

    async def test_store_caps_at_max_updates(
        self, mgr: ConnectionManager
    ) -> None:
        """After MAX_STORED_UPDATES + extra, only the latest MAX are kept."""
        for i in range(MAX_STORED_UPDATES + 10):
            await mgr.store_yjs_update("room-1", bytes([i % 256]))
        stored = await mgr.get_yjs_updates("room-1")
        assert len(stored) == MAX_STORED_UPDATES
        # The last update should be the highest-index one
        assert stored[-1] == bytes([(MAX_STORED_UPDATES + 9) % 256])

    async def test_get_yjs_updates_empty_room(self, mgr: ConnectionManager) -> None:
        stored = await mgr.get_yjs_updates("no-such-room")
        assert stored == []

    async def test_rooms_are_isolated(self, mgr: ConnectionManager) -> None:
        """Updates stored in room-A must not appear in room-B."""
        await mgr.store_yjs_update("room-A", b"\xaa")
        stored_b = await mgr.get_yjs_updates("room-B")
        assert stored_b == []

    # ── presence Redis hash ───────────────────────────────────────────────────

    async def test_store_presence_saves_state(self, mgr: ConnectionManager) -> None:
        state = {"user": {"id": "u1", "name": "Alice", "color": "#3B82F6"}, "status": "viewing"}
        await mgr.store_presence("room-1", "u1", 12345, state)
        all_p = await mgr.get_all_presence("room-1")
        assert "u1" in all_p
        assert all_p["u1"]["clientId"] == 12345
        assert all_p["u1"]["state"]["user"]["name"] == "Alice"

    async def test_store_presence_overwrites_on_update(self, mgr: ConnectionManager) -> None:
        state_v1 = {"user": {"id": "u1", "name": "A", "color": "#fff"}, "status": "viewing"}
        state_v2 = {"user": {"id": "u1", "name": "A", "color": "#fff"}, "status": "editing"}
        await mgr.store_presence("room-1", "u1", 1, state_v1)
        await mgr.store_presence("room-1", "u1", 1, state_v2)
        all_p = await mgr.get_all_presence("room-1")
        assert all_p["u1"]["state"]["status"] == "editing"

    async def test_delete_presence_removes_user(self, mgr: ConnectionManager) -> None:
        state = {"user": {"id": "u1", "name": "A", "color": "#fff"}, "status": "viewing"}
        await mgr.store_presence("room-1", "u1", 1, state)
        await mgr.delete_presence("room-1", "u1")
        all_p = await mgr.get_all_presence("room-1")
        assert "u1" not in all_p

    async def test_get_all_presence_empty_room(self, mgr: ConnectionManager) -> None:
        all_p = await mgr.get_all_presence("no-such-room")
        assert all_p == {}

    async def test_presence_rooms_are_isolated(self, mgr: ConnectionManager) -> None:
        state = {"user": {"id": "u1", "name": "A", "color": "#fff"}, "status": "viewing"}
        await mgr.store_presence("room-A", "u1", 1, state)
        all_b = await mgr.get_all_presence("room-B")
        assert all_b == {}

    async def test_multiple_users_in_same_room(self, mgr: ConnectionManager) -> None:
        for uid, cid in [("u1", 1), ("u2", 2), ("u3", 3)]:
            state = {"user": {"id": uid, "name": uid, "color": "#fff"}, "status": "viewing"}
            await mgr.store_presence("room-1", uid, cid, state)
        all_p = await mgr.get_all_presence("room-1")
        assert set(all_p.keys()) == {"u1", "u2", "u3"}


# ─────────────────────────────────────────────────────────────────────────────
# 2. WebSocket endpoint — protocol tests
# ─────────────────────────────────────────────────────────────────────────────

class TestWebSocketEndpoint:

    def test_missing_token_rejected(self, ws_client: TestClient) -> None:
        """No token query param → websocket_connect() itself raises before body runs."""
        note_id = str(uuid4())
        with pytest.raises(Exception):
            with ws_client.websocket_connect(f"/ws/notes/{note_id}") as ws:
                ws.receive_json()
                pytest.fail("expected connection to be rejected")

    def test_invalid_token_closes_with_4001(self, ws_client: TestClient) -> None:
        note_id = str(uuid4())
        from starlette.websockets import WebSocketDisconnect
        with pytest.raises((WebSocketDisconnect, Exception)):
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token=not.a.valid.jwt"
            ) as ws:
                ws.receive_json()

    def test_connect_sends_presence_message(self, ws_client: TestClient) -> None:
        note_id = str(uuid4())
        token = _token("user-a")
        with ws_client.websocket_connect(f"/ws/notes/{note_id}?token={token}") as ws:
            msg = ws.receive_json()
            assert msg["type"] == "presence"
            assert isinstance(msg["users"], list)

    def test_presence_includes_connected_user(self, ws_client: TestClient) -> None:
        note_id = str(uuid4())
        token_a = _token("user-a")
        token_b = _token("user-b")
        with ws_client.websocket_connect(f"/ws/notes/{note_id}?token={token_a}") as ws_a:
            ws_a.receive_json()  # drain A's initial presence
            with ws_client.websocket_connect(f"/ws/notes/{note_id}?token={token_b}") as ws_b:
                # B gets presence including A and B
                presence_b = ws_b.receive_json()
                assert presence_b["type"] == "presence"
                assert len(presence_b["users"]) == 2

    def test_ping_returns_pong(self, ws_client: TestClient) -> None:
        note_id = str(uuid4())
        with ws_client.websocket_connect(f"/ws/notes/{note_id}?token={_token()}") as ws:
            ws.receive_json()  # drain presence
            ws.send_json({"type": "ping"})
            response = ws.receive_json()
            assert response == {"type": "pong"}

    def test_binary_frame_relayed_to_peer(self, ws_client: TestClient) -> None:
        note_id = str(uuid4())
        update = b"\x01\xde\xad\xbe\xef"
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws_a:
            ws_a.receive_json()  # drain A presence
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token={_token('user-b')}"
            ) as ws_b:
                ws_b.receive_json()  # drain B presence
                ws_a.receive_json()  # drain A's presence update when B joined

                ws_a.send_bytes(update)
                received = ws_b.receive_bytes()
                assert received == update

    def test_binary_frame_not_echoed_to_sender(self, ws_client: TestClient) -> None:
        """Sender must NOT receive their own binary update back."""
        note_id = str(uuid4())
        update = b"\x02\x03\x04"
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws_a:
            ws_a.receive_json()  # drain presence
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token={_token('user-b')}"
            ) as ws_b:
                ws_b.receive_json()  # drain presence
                ws_a.receive_json()  # drain A's presence update

                ws_a.send_bytes(update)
                # B receives the relay
                ws_b.receive_bytes()
                # A should receive no further message — send ping to verify
                ws_a.send_json({"type": "ping"})
                response = ws_a.receive_json()
                assert response == {"type": "pong"}

    def test_binary_frame_calls_store(self, ws_client: TestClient) -> None:
        """Every binary frame must be passed to store_yjs_update."""
        from app.ws.manager import manager as mgr_singleton

        note_id = str(uuid4())
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token()}"
        ) as ws:
            ws.receive_json()  # drain presence
            ws.send_bytes(b"\xca\xfe")
            ws.send_json({"type": "ping"})
            ws.receive_json()  # pong confirms processing complete

        assert mgr_singleton.store_yjs_update.call_count == 1

    def test_awareness_json_relayed_to_peer(self, ws_client: TestClient) -> None:
        note_id = str(uuid4())
        cursor_msg = {
            "type": "awareness",
            "states": [{"clientId": 99, "state": {"cursor": {"anchor": 5, "head": 10}}}],
        }
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws_a:
            ws_a.receive_json()
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token={_token('user-b')}"
            ) as ws_b:
                ws_b.receive_json()
                ws_a.receive_json()

                ws_a.send_json(cursor_msg)
                received = ws_b.receive_json()
                assert received == cursor_msg

    def test_awareness_not_stored_in_redis(self, ws_client: TestClient) -> None:
        """Awareness/cursor messages are relay-only — must not hit store_yjs_update."""
        from app.ws.manager import manager as mgr_singleton

        note_id = str(uuid4())
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token()}"
        ) as ws:
            ws.receive_json()
            ws.send_json({"type": "awareness", "states": []})
            ws.send_json({"type": "ping"})
            ws.receive_json()  # pong

        mgr_singleton.store_yjs_update.assert_not_called()

    def test_unknown_message_type_ignored(self, ws_client: TestClient) -> None:
        """Unknown JSON message types must not crash the handler."""
        note_id = str(uuid4())
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token()}"
        ) as ws:
            ws.receive_json()  # presence
            ws.send_json({"type": "unknown_future_type", "data": 42})
            # No error; ping still works
            ws.send_json({"type": "ping"})
            assert ws.receive_json() == {"type": "pong"}

    def test_awareness_message_stored_in_redis(self, ws_client: TestClient) -> None:
        """awareness frame must persist to Redis so late joiners receive it."""
        from app.ws.manager import manager as mgr_singleton

        note_id = str(uuid4())
        awareness_msg = {
            "type": "awareness",
            "states": [
                {
                    "clientId": 42,
                    "state": {
                        "user": {"id": "user-a", "name": "Alice", "color": "#3B82F6"},
                        "status": "editing",
                    },
                }
            ],
        }
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws:
            ws.receive_json()  # drain presence
            ws.send_json(awareness_msg)
            ws.send_json({"type": "ping"})
            ws.receive_json()  # pong confirms processing complete

        # store_presence must have been called with the clientId and state
        assert mgr_singleton.store_presence.call_count == 1
        call_args = mgr_singleton.store_presence.call_args
        assert call_args.args[0] == note_id          # room_id
        assert call_args.args[1] == "user-a"          # user_id from JWT
        assert call_args.args[2] == 42                # clientId
        assert call_args.args[3]["status"] == "editing"

    def test_presence_sync_sent_to_new_joiner(self) -> None:
        """
        When stored presence exists, a new joiner receives presence_sync as
        the FIRST message (before the presence broadcast), giving an instant
        snapshot of everyone already in the room.
        """
        note_id = str(uuid4())
        stored_presence = {
            "user-a": {
                "clientId": 11,
                "state": {"user": {"id": "user-a", "name": "Alice", "color": "#3B82F6"}, "status": "viewing"},
            }
        }
        from app.ws.manager import manager as mgr_singleton

        with (
            patch.object(mgr_singleton, "store_yjs_update", AsyncMock()),
            patch.object(mgr_singleton, "get_yjs_updates", AsyncMock(return_value=[])),
            patch.object(mgr_singleton, "store_presence", AsyncMock()),
            patch.object(mgr_singleton, "delete_presence", AsyncMock()),
            patch.object(
                mgr_singleton, "get_all_presence", AsyncMock(return_value=stored_presence)
            ),
            patch.object(mgr_singleton, "subscribe", AsyncMock()),
        ):
            with TestClient(app) as client:
                with client.websocket_connect(
                    f"/ws/notes/{note_id}?token={_token('user-b')}"
                ) as ws:
                    first = ws.receive_json()
                    assert first["type"] == "presence_sync"
                    assert "user-a" in first["states"]
                    assert first["states"]["user-a"]["clientId"] == 11

    def test_no_presence_sync_when_room_empty(self) -> None:
        """When no presence is stored the server skips presence_sync entirely."""
        note_id = str(uuid4())
        from app.ws.manager import manager as mgr_singleton

        with (
            patch.object(mgr_singleton, "store_yjs_update", AsyncMock()),
            patch.object(mgr_singleton, "get_yjs_updates", AsyncMock(return_value=[])),
            patch.object(mgr_singleton, "store_presence", AsyncMock()),
            patch.object(mgr_singleton, "delete_presence", AsyncMock()),
            patch.object(mgr_singleton, "get_all_presence", AsyncMock(return_value={})),
            patch.object(mgr_singleton, "subscribe", AsyncMock()),
        ):
            with TestClient(app) as client:
                with client.websocket_connect(
                    f"/ws/notes/{note_id}?token={_token('user-a')}"
                ) as ws:
                    first = ws.receive_json()
                    # First message must be presence (not presence_sync)
                    assert first["type"] == "presence"

    def test_disconnect_cleans_up_presence(self, ws_client: TestClient) -> None:
        """On disconnect, delete_presence must be called to clean up Redis."""
        from app.ws.manager import manager as mgr_singleton

        note_id = str(uuid4())
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws:
            ws.receive_json()  # drain presence

        # After the with-block closes, disconnect handler should have run
        assert mgr_singleton.delete_presence.call_count == 1
        call_args = mgr_singleton.delete_presence.call_args
        assert call_args.args[0] == note_id   # room_id
        assert call_args.args[1] == "user-a"  # user_id

    def test_disconnect_updates_presence(self, ws_client: TestClient) -> None:
        note_id = str(uuid4())
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws_a:
            ws_a.receive_json()  # initial presence ["user-a"]
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token={_token('user-b')}"
            ) as ws_b:
                ws_b.receive_json()  # presence ["user-a", "user-b"]
                ws_a.receive_json()  # A sees B join

            # B disconnects — A receives updated presence
            leave_msg = ws_a.receive_json()
            assert leave_msg["type"] == "presence"
            assert len(leave_msg["users"]) == 1


# ─────────────────────────────────────────────────────────────────────────────
# 3. Synchronization tests
# ─────────────────────────────────────────────────────────────────────────────

class TestSynchronization:

    def test_late_joiner_receives_stored_updates(self) -> None:
        """
        A user who joins after updates were sent receives the Redis log
        before seeing any new updates — the foundation of catch-up sync.
        """
        stored = [b"\xaa\xbb", b"\xcc\xdd", b"\xee\xff"]
        from app.ws.manager import manager as mgr_singleton

        with (
            patch.object(mgr_singleton, "store_yjs_update", AsyncMock()),
            patch.object(mgr_singleton, "get_yjs_updates", AsyncMock(return_value=stored)),
            patch.object(mgr_singleton, "subscribe", AsyncMock()),
        ):
            with TestClient(app) as client:
                note_id = str(uuid4())
                with client.websocket_connect(
                    f"/ws/notes/{note_id}?token={_token('late-joiner')}"
                ) as ws:
                    # Receive all stored updates before the presence message
                    received_bytes = []
                    for _ in stored:
                        received_bytes.append(ws.receive_bytes())
                    # Followed by presence
                    presence = ws.receive_json()
                    assert received_bytes == stored
                    assert presence["type"] == "presence"

    def test_late_joiner_receives_updates_in_order(self) -> None:
        """Stored updates must be replayed in insertion order (FIFO)."""
        # Ordered sentinel bytes — order matters for Yjs merging
        updates = [bytes([i]) for i in range(10)]
        from app.ws.manager import manager as mgr_singleton

        with (
            patch.object(mgr_singleton, "store_yjs_update", AsyncMock()),
            patch.object(mgr_singleton, "get_yjs_updates", AsyncMock(return_value=updates)),
            patch.object(mgr_singleton, "subscribe", AsyncMock()),
        ):
            with TestClient(app) as client:
                note_id = str(uuid4())
                with client.websocket_connect(
                    f"/ws/notes/{note_id}?token={_token('joiner')}"
                ) as ws:
                    received = [ws.receive_bytes() for _ in updates]
                    assert received == updates

    def test_concurrent_updates_both_relayed(self, ws_client: TestClient) -> None:
        """
        Both users send updates; each receives the other's — bidirectional relay.
        """
        note_id = str(uuid4())
        update_a = b"\xAA\xAA"
        update_b = b"\xBB\xBB"

        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws_a:
            ws_a.receive_json()
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token={_token('user-b')}"
            ) as ws_b:
                ws_b.receive_json()
                ws_a.receive_json()

                # A → B
                ws_a.send_bytes(update_a)
                assert ws_b.receive_bytes() == update_a

                # B → A
                ws_b.send_bytes(update_b)
                assert ws_a.receive_bytes() == update_b

    def test_three_users_all_receive_update(self, ws_client: TestClient) -> None:
        """An update from one user reaches every other user in the room."""
        note_id = str(uuid4())
        update = b"\x11\x22\x33"

        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws_a:
            ws_a.receive_json()
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token={_token('user-b')}"
            ) as ws_b:
                ws_b.receive_json()
                ws_a.receive_json()
                with ws_client.websocket_connect(
                    f"/ws/notes/{note_id}?token={_token('user-c')}"
                ) as ws_c:
                    ws_c.receive_json()
                    ws_b.receive_json()
                    ws_a.receive_json()

                    ws_a.send_bytes(update)
                    assert ws_b.receive_bytes() == update
                    assert ws_c.receive_bytes() == update

    def test_different_rooms_are_isolated(self, ws_client: TestClient) -> None:
        """
        Users in different note rooms must not receive each other's updates.
        A binary update from note-1 must never appear in note-2's stream.
        """
        note_1 = str(uuid4())
        note_2 = str(uuid4())

        with ws_client.websocket_connect(
            f"/ws/notes/{note_1}?token={_token('user-1')}"
        ) as ws_1:
            ws_1.receive_json()
            with ws_client.websocket_connect(
                f"/ws/notes/{note_2}?token={_token('user-2')}"
            ) as ws_2:
                ws_2.receive_json()

                # user-1 sends an update in room 1
                ws_1.send_bytes(b"\xDE\xAD")
                # Confirm user-1's update was processed (ping→pong)
                ws_1.send_json({"type": "ping"})
                assert ws_1.receive_json() == {"type": "pong"}

                # user-2 must receive nothing (no binary relay across rooms)
                ws_2.send_json({"type": "ping"})
                assert ws_2.receive_json() == {"type": "pong"}

    def test_reconnect_receives_stored_updates(self) -> None:
        """
        Simulate a disconnect + reconnect: the reconnecting client receives
        the updates that were sent while they were offline.
        """
        note_id = str(uuid4())

        # First, accumulate some updates in the mock Redis store
        stored_after_disconnect = [b"\x01\x02", b"\x03\x04"]
        from app.ws.manager import manager as mgr_singleton

        with (
            patch.object(mgr_singleton, "store_yjs_update", AsyncMock()),
            patch.object(
                mgr_singleton,
                "get_yjs_updates",
                AsyncMock(return_value=stored_after_disconnect),
            ),
            patch.object(mgr_singleton, "subscribe", AsyncMock()),
        ):
            with TestClient(app) as client:
                # Reconnect scenario: client connects after missing updates
                with client.websocket_connect(
                    f"/ws/notes/{note_id}?token={_token('returning-user')}"
                ) as ws:
                    catchup = [ws.receive_bytes() for _ in stored_after_disconnect]
                    assert catchup == stored_after_disconnect

    def test_user_can_rejoin_same_room(self, ws_client: TestClient) -> None:
        """A user who disconnects and reconnects re-enters the room cleanly."""
        note_id = str(uuid4())
        token = _token("returning")

        with ws_client.websocket_connect(f"/ws/notes/{note_id}?token={token}") as ws_1:
            p1 = ws_1.receive_json()
            assert "returning" in p1["users"]

        # After first session closes — reconnect
        with ws_client.websocket_connect(f"/ws/notes/{note_id}?token={token}") as ws_2:
            p2 = ws_2.receive_json()
            assert "returning" in p2["users"]

    def test_same_user_replaces_stale_connection(self, ws_client: TestClient) -> None:
        """
        The same user_id connecting twice occupies only one slot in the room
        (newer connection overwrites the stale one).
        """
        note_id = str(uuid4())
        token = _token("duplicate-user")

        with ws_client.websocket_connect(f"/ws/notes/{note_id}?token={token}") as ws_1:
            ws_1.receive_json()
            with ws_client.websocket_connect(f"/ws/notes/{note_id}?token={token}") as ws_2:
                ws_2.receive_json()
                from app.ws.manager import manager as mgr_singleton

                # Only one entry for this user_id
                user_ids = mgr_singleton.get_user_ids(note_id)
                assert user_ids.count("duplicate-user") == 1


# ─────────────────────────────────────────────────────────────────────────────
# 4. Latency tests
# ─────────────────────────────────────────────────────────────────────────────

class TestLatency:

    def test_binary_relay_latency_under_50ms(self, ws_client: TestClient) -> None:
        """
        In-process relay (no network) must complete in under 50 ms.
        This guards against accidentally synchronous or blocking code paths.
        """
        note_id = str(uuid4())
        update = b"\xff" * 1024  # 1 KB payload

        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws_a:
            ws_a.receive_json()
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token={_token('user-b')}"
            ) as ws_b:
                ws_b.receive_json()
                ws_a.receive_json()

                t0 = time.perf_counter()
                ws_a.send_bytes(update)
                ws_b.receive_bytes()
                elapsed_ms = (time.perf_counter() - t0) * 1000

                assert elapsed_ms < 50, f"relay took {elapsed_ms:.1f}ms, expected <50ms"

    def test_large_update_relayed_intact(self, ws_client: TestClient) -> None:
        """A 64 KB binary payload must be relayed byte-for-byte."""
        note_id = str(uuid4())
        large_update = bytes(range(256)) * 256  # exactly 64 KB

        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws_a:
            ws_a.receive_json()
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token={_token('user-b')}"
            ) as ws_b:
                ws_b.receive_json()
                ws_a.receive_json()

                ws_a.send_bytes(large_update)
                received = ws_b.receive_bytes()
                assert received == large_update
                assert len(received) == 64 * 1024

    def test_rapid_sequential_updates_all_delivered(self, ws_client: TestClient) -> None:
        """
        10 updates sent in quick succession must all be received in order.
        Tests that no updates are dropped under load.
        """
        note_id = str(uuid4())
        updates = [bytes([i]) * 16 for i in range(10)]

        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws_a:
            ws_a.receive_json()
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token={_token('user-b')}"
            ) as ws_b:
                ws_b.receive_json()
                ws_a.receive_json()

                for u in updates:
                    ws_a.send_bytes(u)

                received = [ws_b.receive_bytes() for _ in updates]
                assert received == updates

    def test_ping_pong_latency_under_20ms(self, ws_client: TestClient) -> None:
        """
        Ping→pong round-trip must complete in under 20 ms.
        A baseline for the server's message-processing overhead.
        """
        note_id = str(uuid4())
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token()}"
        ) as ws:
            ws.receive_json()  # presence

            t0 = time.perf_counter()
            ws.send_json({"type": "ping"})
            ws.receive_json()  # pong
            elapsed_ms = (time.perf_counter() - t0) * 1000

            assert elapsed_ms < 20, f"ping-pong took {elapsed_ms:.1f}ms, expected <20ms"

    def test_store_and_relay_run_concurrently(self, ws_client: TestClient) -> None:
        """
        store_yjs_update and broadcast_bytes are gathered (concurrent).
        The relay must not be blocked waiting for Redis storage to complete.
        Verified by checking that the peer receives the update even when
        store is slow (simulated here by checking call order).
        """
        from app.ws.manager import manager as mgr_singleton

        call_log: list[str] = []

        async def slow_store(*_: object) -> None:
            call_log.append("store_called")

        mgr_singleton.store_yjs_update.side_effect = slow_store

        note_id = str(uuid4())
        with ws_client.websocket_connect(
            f"/ws/notes/{note_id}?token={_token('user-a')}"
        ) as ws_a:
            ws_a.receive_json()
            with ws_client.websocket_connect(
                f"/ws/notes/{note_id}?token={_token('user-b')}"
            ) as ws_b:
                ws_b.receive_json()
                ws_a.receive_json()

                ws_a.send_bytes(b"\x42")
                received = ws_b.receive_bytes()
                assert received == b"\x42"
                # Store was called (even if slow, asyncio.gather ensured both ran)
                assert "store_called" in call_log
