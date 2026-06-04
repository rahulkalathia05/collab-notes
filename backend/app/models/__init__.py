# Import all models so Alembic autogenerate can discover them
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.models.note import Note, NoteVersion, Comment
from app.models.embedding import NoteEmbedding
from app.models.analytics import AIEvent

__all__ = ["User", "Workspace", "WorkspaceMember", "Note", "NoteVersion", "Comment", "NoteEmbedding", "AIEvent"]
