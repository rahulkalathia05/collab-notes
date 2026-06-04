"""add ai_events table for analytics

Revision ID: d3e5f7a9b1c2
Revises: c3e5g7i9k1m3
Create Date: 2026-06-04 18:00:00.000000

ai_events is an append-only event log written as a FireAndForget background
task by the AI endpoints (summarize, writing-assist).  It is intentionally
narrow — just enough to answer "how often is each AI feature used?" without
storing any content.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'd3e5f7a9b1c2'
down_revision: Union[str, None] = 'c3e5g7i9k1m3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE ai_events (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            workspace_id UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            note_id      UUID        REFERENCES notes(id) ON DELETE SET NULL,
            user_id      UUID        NOT NULL REFERENCES users(id),
            action       VARCHAR(50) NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX ix_ai_events_ws_created ON ai_events(workspace_id, created_at)")
    op.execute("CREATE INDEX ix_ai_events_user_created ON ai_events(user_id, created_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_ai_events_user_created")
    op.execute("DROP INDEX IF EXISTS ix_ai_events_ws_created")
    op.execute("DROP TABLE IF EXISTS ai_events")
