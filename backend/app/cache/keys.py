"""
Redis key schema for application-level caching.

All keys are prefixed with "cache:" to separate them from:
  yjs:{room_id}         — Yjs document update lists (ws/manager.py)
  presence:{room_id}    — awareness state hashes (ws/manager.py)
  blocklist:{jti}       — JWT revocation list (core/security.py)

Key hierarchy
─────────────
cache:note:{workspace_id}:{note_id}        full NoteResponse JSON          TTL 120 s
cache:notes:list:{workspace_id}            list[NoteListItem] JSON         TTL  60 s
cache:ws:meta:{workspace_id}:{user_id}     WorkspaceResponse JSON          TTL 600 s
cache:ws:members:{workspace_id}            list[WorkspaceMemberResponse]   TTL 300 s
cache:membership:{workspace_id}:{user_id}  role string                     TTL 300 s
cache:search:{16-hex digest}               SearchResponse JSON             TTL  60 s
cache:stats:{type}:{hits|misses}           INCR counters (no expiry)

The workspace metadata key is per-user because WorkspaceResponse includes the
caller's role (which differs per member). Invalidation uses SCAN with the
pattern "cache:ws:meta:{workspace_id}:*" to delete all user-specific entries
at once when workspace metadata changes.
"""

from __future__ import annotations

import hashlib
from uuid import UUID

_P = "cache"  # global prefix


def note_key(workspace_id: UUID | str, note_id: UUID | str) -> str:
    return f"{_P}:note:{workspace_id}:{note_id}"


def notes_list_key(workspace_id: UUID | str) -> str:
    return f"{_P}:notes:list:{workspace_id}"


def workspace_key(workspace_id: UUID | str, user_id: UUID | str) -> str:
    return f"{_P}:ws:meta:{workspace_id}:{user_id}"


def workspace_meta_pattern(workspace_id: UUID | str) -> str:
    """SCAN pattern to delete all user-specific workspace views at once."""
    return f"{_P}:ws:meta:{workspace_id}:*"


def members_key(workspace_id: UUID | str) -> str:
    return f"{_P}:ws:members:{workspace_id}"


def membership_key(workspace_id: UUID | str, user_id: UUID | str) -> str:
    return f"{_P}:membership:{workspace_id}:{user_id}"


def search_key(
    user_id: UUID | str,
    q: str,
    mode: str,
    workspace_id: UUID | str | None,
    page: int,
    page_size: int,
) -> str:
    raw = f"{user_id}:{q}:{mode}:{workspace_id or ''}:{page}:{page_size}"
    digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return f"{_P}:search:{digest}"


def stat_key(cache_type: str, metric: str) -> str:
    return f"{_P}:stats:{cache_type}:{metric}"
