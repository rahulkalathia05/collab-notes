import uuid
from datetime import datetime, timezone
from sqlalchemy import JSON, String, Text, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, mapped_column, Mapped
from app.models.base import Base, TimestampMixin

# JSONB on PostgreSQL (binary storage, indexable); falls back to JSON on SQLite for tests
_JSONB = JSONB().with_variant(JSON(), "sqlite")


class Note(Base, TimestampMixin):
    __tablename__ = "notes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False, server_default="Untitled")
    content: Mapped[dict | None] = mapped_column(_JSONB, nullable=True)
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    # default=False sets the Python-level default so SQLAlchemy always includes
    # the value in INSERT — avoids SQLite treating server_default="false" as the
    # string "false" (truthy) instead of the integer 0.
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    workspace = relationship("Workspace", back_populates="notes", lazy="select")
    creator = relationship("User", foreign_keys=[created_by], lazy="select")
    updater = relationship("User", foreign_keys=[updated_by], lazy="select")
    versions = relationship("NoteVersion", back_populates="note", cascade="all, delete-orphan", lazy="select")
    comments = relationship("Comment", back_populates="note", cascade="all, delete-orphan", lazy="select")


class NoteVersion(Base):
    __tablename__ = "note_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    content: Mapped[dict] = mapped_column(_JSONB, nullable=False)
    content_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    snapshot_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Python-level default gives microsecond precision — avoids same-second
    # collisions when two versions are created rapidly (common in tests and
    # in restore_version which creates a pre-restore snapshot).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )

    note = relationship("Note", back_populates="versions", lazy="select")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("notes.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    anchor_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    note = relationship("Note", back_populates="comments", lazy="select")
    user = relationship("User", foreign_keys=[user_id], lazy="select")
