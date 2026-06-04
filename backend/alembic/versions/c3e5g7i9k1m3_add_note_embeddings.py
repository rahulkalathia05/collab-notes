"""add note_embeddings table with HNSW vector index

Revision ID: c3e5g7i9k1m3
Revises: b2d4f6a8c0e1
Create Date: 2026-06-04 14:00:00.000000

Architecture notes
------------------
* Separate table keeps the hot `notes` row compact (1 536 floats ≈ 6 KB per note).
* HNSW index: no training data required — works from row 0, unlike IVFFlat which
  needs at least `lists` rows before it is useful. m=16 and ef_construction=64
  are conservative defaults; raise ef_construction for better recall on large
  datasets at the cost of slower inserts.
* ON DELETE CASCADE ensures embeddings are removed with their note automatically.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c3e5g7i9k1m3'
down_revision: Union[str, None] = 'b2d4f6a8c0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DIMS = 1536  # text-embedding-3-small output dimensions


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.execute(f"""
        CREATE TABLE note_embeddings (
            note_id      UUID        PRIMARY KEY
                                     REFERENCES notes(id) ON DELETE CASCADE,
            embedding    vector({_DIMS}) NOT NULL,
            model        TEXT        NOT NULL DEFAULT 'text-embedding-3-small',
            token_count  INTEGER,
            embedded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    # HNSW index for approximate nearest-neighbour search using cosine distance.
    # ef_search (query-time) is set per-session at search time for tuning.
    op.execute("""
        CREATE INDEX ix_note_embeddings_hnsw
        ON note_embeddings
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_note_embeddings_hnsw")
    op.execute("DROP TABLE IF EXISTS note_embeddings")
