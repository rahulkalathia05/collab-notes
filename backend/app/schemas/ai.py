from enum import Enum
from uuid import UUID
from pydantic import BaseModel, Field


class SummarizeRequest(BaseModel):
    note_id: UUID
    workspace_id: UUID


class WritingAssistAction(str, Enum):
    rewrite = "rewrite"
    improve_writing = "improve_writing"
    grammar_correction = "grammar_correction"
    expand_section = "expand_section"
    shorten_section = "shorten_section"


class WritingAssistRequest(BaseModel):
    note_id: UUID
    workspace_id: UUID
    action: WritingAssistAction
    selected_text: str = Field(..., min_length=1, max_length=10_000)
    context: str | None = Field(None, max_length=5_000)
