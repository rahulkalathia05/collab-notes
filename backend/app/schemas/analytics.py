from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class DateCount(BaseModel):
    date: str   # ISO date "YYYY-MM-DD"
    count: int


class AIUsagePoint(BaseModel):
    date: str
    count: int
    by_action: dict[str, int]


class OverviewMetrics(BaseModel):
    total_notes: int
    total_users: int
    total_edits: int
    total_ai_calls: int
    total_comments: int
    notes_delta: int      # change vs. previous period
    edits_delta: int
    ai_delta: int
    comments_delta: int


class TopNote(BaseModel):
    note_id: UUID
    title: str
    edits: int
    comments: int
    last_activity: datetime


class MemberActivity(BaseModel):
    user_id: UUID
    name: str
    email: str
    avatar_url: str | None = None
    notes_created: int
    edits: int
    comments: int
    total: int


class AnalyticsResponse(BaseModel):
    workspace_id: UUID
    period_days: int
    generated_at: datetime
    overview: OverviewMetrics
    notes_over_time: list[DateCount]
    edits_over_time: list[DateCount]
    active_users_over_time: list[DateCount]
    ai_usage_over_time: list[AIUsagePoint]
    collaboration_over_time: list[DateCount]
    top_notes: list[TopNote]
    member_activity: list[MemberActivity]
