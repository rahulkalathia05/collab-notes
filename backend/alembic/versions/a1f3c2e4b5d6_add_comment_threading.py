"""add comment threading and selection anchors

Revision ID: a1f3c2e4b5d6
Revises: d92d15bbcee5
Create Date: 2026-06-04 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a1f3c2e4b5d6'
down_revision: Union[str, None] = 'd92d15bbcee5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('comments', sa.Column('parent_id', sa.UUID(), nullable=True))
    op.add_column('comments', sa.Column('comment_type', sa.String(length=20), server_default='note', nullable=False))
    op.add_column('comments', sa.Column('selection_from', sa.Integer(), nullable=True))
    op.add_column('comments', sa.Column('selection_to', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_comments_parent_id',
        'comments', 'comments',
        ['parent_id'], ['id'],
        ondelete='CASCADE',
    )
    op.create_index('ix_comments_note_id', 'comments', ['note_id'])
    op.create_index('ix_comments_parent_id', 'comments', ['parent_id'])


def downgrade() -> None:
    op.drop_index('ix_comments_parent_id', table_name='comments')
    op.drop_index('ix_comments_note_id', table_name='comments')
    op.drop_constraint('fk_comments_parent_id', 'comments', type_='foreignkey')
    op.drop_column('comments', 'selection_to')
    op.drop_column('comments', 'selection_from')
    op.drop_column('comments', 'comment_type')
    op.drop_column('comments', 'parent_id')
