"""
Embedding service — generates and stores OpenAI vector embeddings for notes.

Indexing strategy
-----------------
* Called as a FastAPI BackgroundTask after note create/update so it never
  blocks the HTTP response.
* Uses its own DB session (the request session is closed by the time the
  background task runs).
* Upserts into note_embeddings — safe to call multiple times; if the note
  content didn't actually change the embedding stays up-to-date.
* Truncates combined text to _MAX_CHARS before embedding to stay well within
  the model's 8 191-token context window.
* Silently skips if OPENAI_API_KEY is not configured — FTS still works.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from loguru import logger
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.embedding import NoteEmbedding
from app.models.note import Note

if TYPE_CHECKING:
    pass

_MAX_CHARS = 8_000   # ~6 000 tokens for text-embedding-3-small (8 191 limit)
_MODEL = "text-embedding-3-small"
_DIMS = 1536


def _build_text(title: str, content_text: str | None) -> str:
    """Combine title and body into a single string for embedding."""
    parts = [title.strip()]
    if content_text and content_text.strip():
        parts.append(content_text.strip())
    return "\n\n".join(parts)[:_MAX_CHARS]


class EmbeddingService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── public ────────────────────────────────────────────────────────────────

    async def embed_note(self, note_id: uuid.UUID) -> bool:
        """
        Generate and upsert the embedding for a single note.
        Returns True if an embedding was stored, False if skipped.
        """
        if not settings.OPENAI_API_KEY:
            return False

        note = await self.session.get(Note, note_id)
        if not note or note.is_archived:
            return False

        text_to_embed = _build_text(note.title, note.content_text)
        if not text_to_embed.strip():
            return False

        try:
            vector, token_count = await _call_openai(text_to_embed)
        except Exception:
            logger.exception("Failed to generate embedding for note {}", note_id)
            return False

        await self._upsert(note_id, vector, token_count)
        return True

    async def embed_many(self, note_ids: list[uuid.UUID]) -> dict[str, int]:
        """Batch-embed a list of notes. Returns {ok: n, skipped: n, failed: n}."""
        counts = {"ok": 0, "skipped": 0, "failed": 0}
        for nid in note_ids:
            try:
                ok = await self.embed_note(nid)
                counts["ok" if ok else "skipped"] += 1
            except Exception:
                counts["failed"] += 1
        return counts

    async def reindex_workspace(self, workspace_id: uuid.UUID) -> dict[str, int]:
        """Re-embed all non-archived notes in a workspace."""
        result = await self.session.execute(
            select(Note.id).where(
                Note.workspace_id == workspace_id,
                Note.is_archived.is_(False),
            )
        )
        note_ids = [row[0] for row in result.all()]
        return await self.embed_many(note_ids)

    async def reindex_all(self) -> dict[str, int]:
        """Re-embed every non-archived note. Intended for admin / first-run."""
        result = await self.session.execute(
            select(Note.id).where(Note.is_archived.is_(False))
        )
        note_ids = [row[0] for row in result.all()]
        return await self.embed_many(note_ids)

    # ── private ───────────────────────────────────────────────────────────────

    async def _upsert(
        self, note_id: uuid.UUID, vector: list[float], token_count: int | None
    ) -> None:
        existing = await self.session.get(NoteEmbedding, note_id)
        if existing:
            existing.embedding = vector  # type: ignore[assignment]
            existing.model = _MODEL
            existing.token_count = token_count
            await self.session.execute(
                text("UPDATE note_embeddings SET embedded_at = now() WHERE note_id = :id"),
                {"id": str(note_id)},
            )
        else:
            self.session.add(
                NoteEmbedding(
                    note_id=note_id,
                    embedding=vector,
                    model=_MODEL,
                    token_count=token_count,
                )
            )
        await self.session.flush()


# ── OpenAI call (module-level so it's mockable in tests) ─────────────────────

async def _call_openai(text: str) -> tuple[list[float], int | None]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    resp = await client.embeddings.create(
        model=_MODEL,
        input=text,
        encoding_format="float",
    )
    vec = resp.data[0].embedding
    tokens = resp.usage.total_tokens if resp.usage else None
    return vec, tokens


async def embed_query(query: str) -> list[float] | None:
    """Embed a search query string. Returns None if API key not set or call fails."""
    if not settings.OPENAI_API_KEY:
        return None
    try:
        vec, _ = await _call_openai(query[:_MAX_CHARS])
        return vec
    except Exception:
        logger.exception("Failed to embed search query")
        return None
