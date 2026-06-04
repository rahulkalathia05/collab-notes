"""add full-text search vector to notes

Revision ID: b2d4f6a8c0e1
Revises: a1f3c2e4b5d6
Create Date: 2026-06-04 12:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'b2d4f6a8c0e1'
down_revision: Union[str, None] = 'a1f3c2e4b5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Generated stored column — auto-updates whenever title or content_text changes.
    # Title (weight A) outranks body (weight C) in ts_rank results.
    op.execute("""
        ALTER TABLE notes
        ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(content_text, '')), 'C')
        ) STORED
    """)
    # GIN index — required for fast tsvector lookups (otherwise PostgreSQL falls back to seqscan)
    op.execute("CREATE INDEX ix_notes_fts ON notes USING GIN (search_vector)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_notes_fts")
    op.execute("ALTER TABLE notes DROP COLUMN IF EXISTS search_vector")
