"""
Analytics service — orchestrates repository queries, enforces auth, caches results.

Cache key: cache:analytics:{workspace_id}:{period_days}   TTL 300 s
Cached as a flat JSON blob; any write to the workspace invalidates it via the
workspace-level cache bust in workspace_service (which already clears
cache:ws:meta:{wid}:*). The analytics cache is a separate namespace and must
be explicitly invalidated here if tighter freshness is needed.
"""

import asyncio
import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.analytics_repository import AnalyticsRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.analytics import (
    AIUsagePoint,
    AnalyticsResponse,
    DateCount,
    MemberActivity,
    OverviewMetrics,
    TopNote,
)

_VALID_PERIODS = {7, 30, 90}
_CACHE_TTL = 300  # 5 minutes


class AnalyticsService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self.repo = AnalyticsRepository(db)
        self.ws_repo = WorkspaceRepository(db)

    async def get(
        self,
        workspace_id: UUID,
        user_id: UUID,
        period_days: int,
    ) -> AnalyticsResponse:
        if period_days not in _VALID_PERIODS:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"period_days must be one of {sorted(_VALID_PERIODS)}",
            )

        # Auth: any workspace member may view analytics
        membership = await self.ws_repo.get_membership(workspace_id, user_id)
        if not membership:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Access denied")

        # Check cache
        cached = await self._cache_get(workspace_id, period_days)
        if cached:
            return AnalyticsResponse.model_validate(cached)

        # Run all queries concurrently — independent reads, no write ordering needed
        (
            overview_raw,
            notes_ts,
            edits_ts,
            users_ts,
            ai_ts,
            collab_ts,
            top_raw,
            members_raw,
        ) = await asyncio.gather(
            self.repo.overview(workspace_id, period_days),
            self.repo.notes_over_time(workspace_id, period_days),
            self.repo.edits_over_time(workspace_id, period_days),
            self.repo.active_users_over_time(workspace_id, period_days),
            self.repo.ai_usage_over_time(workspace_id, period_days),
            self.repo.collaboration_over_time(workspace_id, period_days),
            self.repo.top_notes(workspace_id, period_days),
            self.repo.member_activity(workspace_id, period_days),
        )

        overview = OverviewMetrics(
            total_notes=int(overview_raw["total_notes"]),
            total_users=int(overview_raw["total_users"]),
            total_edits=int(overview_raw["edits_current"]),
            total_ai_calls=int(overview_raw["ai_current"]),
            total_comments=int(overview_raw["comments_current"]),
            notes_delta=int(overview_raw["notes_current"]) - int(overview_raw["notes_prev"]),
            edits_delta=int(overview_raw["edits_current"]) - int(overview_raw["edits_prev"]),
            ai_delta=int(overview_raw["ai_current"]) - int(overview_raw["ai_prev"]),
            comments_delta=int(overview_raw["comments_current"]) - int(overview_raw["comments_prev"]),
        )

        response = AnalyticsResponse(
            workspace_id=workspace_id,
            period_days=period_days,
            generated_at=datetime.now(timezone.utc),
            overview=overview,
            notes_over_time=[DateCount(**r) for r in notes_ts],
            edits_over_time=[DateCount(**r) for r in edits_ts],
            active_users_over_time=[DateCount(**r) for r in users_ts],
            ai_usage_over_time=[
                AIUsagePoint(date=r["date"], count=r["count"], by_action=r["by_action"])
                for r in ai_ts
            ],
            collaboration_over_time=[DateCount(**r) for r in collab_ts],
            top_notes=[
                TopNote(
                    note_id=r["note_id"],
                    title=r["title"],
                    edits=r["edits"],
                    comments=r["comments"],
                    last_activity=r["last_activity"],
                )
                for r in top_raw
            ],
            member_activity=[
                MemberActivity(
                    user_id=r["user_id"],
                    name=r["name"],
                    email=r["email"],
                    avatar_url=r.get("avatar_url"),
                    notes_created=r["notes_created"],
                    edits=r["edits"],
                    comments=r["comments"],
                    total=r["total"],
                )
                for r in members_raw
            ],
        )

        await self._cache_set(workspace_id, period_days, response.model_dump(mode="json"))
        return response

    # ── cache helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _cache_key(workspace_id: UUID, period_days: int) -> str:
        return f"cache:analytics:{workspace_id}:{period_days}"

    async def _cache_get(self, workspace_id: UUID, period_days: int) -> dict | None:
        try:
            import redis.asyncio as aioredis
            from app.db.redis import get_pool
            r = aioredis.Redis(connection_pool=get_pool())
            raw = await r.get(self._cache_key(workspace_id, period_days))
            await r.aclose()
            return json.loads(raw) if raw else None
        except Exception:
            return None

    async def _cache_set(self, workspace_id: UUID, period_days: int, data: dict) -> None:
        try:
            import redis.asyncio as aioredis
            from app.db.redis import get_pool
            r = aioredis.Redis(connection_pool=get_pool())
            await r.setex(
                self._cache_key(workspace_id, period_days),
                _CACHE_TTL,
                json.dumps(data, default=str),
            )
            await r.aclose()
        except Exception:
            pass
