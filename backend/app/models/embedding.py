import uuid
from datetime import datetime
from sqlalchemy import DateTime, Integer, String, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, mapped_column, Mapped
from pgvector.sqlalchemy import Vector
from app.models.base import Base

_DIMS = 1536  # text-embedding-3-small


class NoteEmbedding(Base):
    __tablename__ = "note_embeddings"

    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("notes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    embedding: Mapped[list[float]] = mapped_column(Vector(_DIMS), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False, default="text-embedding-3-small")
    token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    embedded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    note = relationship("Note", foreign_keys=[note_id], lazy="select")
