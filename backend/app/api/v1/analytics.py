from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.analytics import AnalyticsResponse
from app.services.analytics_service import AnalyticsService

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/", response_model=AnalyticsResponse)
async def get_analytics(
    workspace_id: UUID = Query(..., description="Workspace to analyse"),
    period_days: int = Query(30, description="Lookback window: 7, 30, or 90"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Return aggregated analytics for a workspace.

    Metrics cover the requested period (7 / 30 / 90 days):
    - overview: totals + delta vs. previous period
    - time-series: notes, edits, active users, AI usage, comments
    - top notes by edit + comment activity
    - per-member activity breakdown

    Results are cached for 5 minutes. Any workspace member may view analytics.
    """
    return await AnalyticsService(db).get(
        workspace_id=workspace_id,
        user_id=current_user.id,
        period_days=period_days,
    )
