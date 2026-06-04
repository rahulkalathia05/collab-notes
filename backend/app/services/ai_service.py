"""
AI service — streaming summarization via OpenAI.

Output format (SSE):
  data: {"text": "..."}                               incremental token
  data: {"type": "done", "summary": "...",            parsed result
          "key_points": [...], "action_items": [...]}
  data: {"type": "error", "message": "..."}           failure
"""

from __future__ import annotations

import json
import re
from collections.abc import AsyncGenerator

from loguru import logger

from app.core.config import settings

# ── text extraction ────────────────────────────────────────────────────────────


def extract_text_from_tiptap(doc: dict | None) -> str:
    """
    Recursively extract readable plain text from a TipTap / ProseMirror JSON doc.

    Handles: paragraph, heading (adds # prefix), bulletList / orderedList
    (adds • prefix), blockquote, codeBlock, hardBreak, and text nodes.
    All other node types are traversed transparently so future extensions
    (e.g. tables, images) do not break extraction.
    """
    if not doc:
        return ""

    parts: list[str] = []

    def _walk(node: dict) -> None:
        t = node.get("type", "")

        if t == "hardBreak":
            parts.append("\n")
            return

        if t == "text":
            parts.append(node.get("text", ""))
            return

        # Structural prefixes — inserted BEFORE traversing children
        if t == "heading":
            level = node.get("attrs", {}).get("level", 1)
            parts.append("\n" + "#" * level + " ")
        elif t == "listItem":
            parts.append("\n• ")
        elif t == "codeBlock":
            lang = node.get("attrs", {}).get("language") or ""
            parts.append(f"\n```{lang}\n")

        for child in node.get("content", []):
            _walk(child)

        # Structural suffixes — inserted AFTER children
        if t in ("paragraph", "heading", "blockquote"):
            parts.append("\n")
        elif t == "codeBlock":
            parts.append("\n```\n")
        elif t in ("bulletList", "orderedList"):
            parts.append("\n")

    _walk(doc)
    text = "".join(parts)
    # Normalise excessive blank lines
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# ── section parser ─────────────────────────────────────────────────────────────


def parse_summary_response(text: str) -> dict:
    """
    Parse the structured AI response into typed sections.

    Expected format:
        ## Summary
        <paragraph>

        ## Key Points
        - item
        - item

        ## Action Items
        - item  (or "- None")
    """
    result: dict[str, str | list[str]] = {
        "summary": "",
        "key_points": [],
        "action_items": [],
    }

    current: str | None = None
    summary_lines: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()

        if line.startswith("## Summary"):
            current = "summary"
        elif line.startswith("## Key Points"):
            current = "key_points"
        elif line.startswith("## Action Items"):
            current = "action_items"
        elif current == "summary" and line:
            summary_lines.append(line)
        elif current in ("key_points", "action_items") and line.startswith("- "):
            item = line[2:].strip()
            if item and item.lower() not in ("none", "n/a", "-"):
                cast_result = result[current]
                if isinstance(cast_result, list):
                    cast_result.append(item)

    result["summary"] = " ".join(summary_lines)
    return result


# ── streaming ─────────────────────────────────────────────────────────────────

_SYSTEM = (
    "You are a helpful assistant that analyzes notes. "
    "Always respond in the exact format specified."
)

_PROMPT = """Analyze this note and provide a structured summary.

Note title: {title}

Note content:
{content}

Respond in this EXACT format using these exact section headers:

## Summary
[2–3 sentences summarizing the main topic and purpose]

## Key Points
- [Most important insight]
- [Second key point]
- [Third key point]
[Add up to 3 more if warranted]

## Action Items
- [Specific action to take]
[Write "- None" if there are no action items]"""


async def stream_summarize(title: str, content: str) -> AsyncGenerator[str, None]:
    """
    Yield Server-Sent Event data lines for the summarize response.

    Tokens are forwarded immediately as {"text": "..."} events so the client
    can show live streaming text.  A final {"type": "done", ...} event carries
    the fully parsed structured result.
    """
    # ── pre-flight checks ────────────────────────────────────────────────────

    if not settings.OPENAI_API_KEY:
        yield _err("OpenAI API key not configured — add OPENAI_API_KEY to .env")
        return

    if not content.strip():
        yield _err("Note has no content to summarize")
        return

    # ── lazy import to avoid startup cost when AI is not used ────────────────

    try:
        from openai import AsyncOpenAI, APIError
    except ImportError:
        yield _err("openai package not installed")
        return

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    full_text = ""
    prompt = _PROMPT.format(
        title=title or "Untitled",
        # Truncate to stay comfortably within context limits
        content=content[:12_000],
    )

    try:
        stream = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": prompt},
            ],
            stream=True,
            max_tokens=1_000,
            temperature=0.3,  # low temperature → deterministic, structured output
        )

        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                full_text += delta
                yield f"data: {json.dumps({'text': delta})}\n\n"

        # Emit the parsed structured result as a terminal event
        parsed = parse_summary_response(full_text)
        yield f"data: {json.dumps({'type': 'done', **parsed})}\n\n"

    except Exception as exc:  # noqa: BLE001
        logger.exception("AI summarize error")
        msg = str(exc)[:300] if settings.DEBUG else "Summarization failed. Try again."
        yield _err(msg)


def _err(message: str) -> str:
    return f"data: {json.dumps({'type': 'error', 'message': message})}\n\n"


# ── writing assistant ──────────────────────────────────────────────────────────

_WRITING_SYSTEM = (
    "You are an expert writing assistant. "
    "Always respond in the exact format specified. "
    "Preserve the author's intended meaning."
)

_WRITING_PROMPTS: dict[str, str] = {
    "rewrite": """\
Rewrite the following text to be clearer, more engaging, and better structured while preserving the original meaning.

Original text:
{text}
{context_block}
Respond in this EXACT format:

## Result
[Your rewritten version]

## Changes Made
- [Key change 1]
- [Key change 2]
[Up to 5 main changes]""",

    "improve_writing": """\
Improve the writing quality of the following text. Focus on clarity, flow, word choice, sentence variety, and readability.

Original text:
{text}
{context_block}
Respond in this EXACT format:

## Result
[Your improved version]

## Changes Made
- [Specific improvement 1]
- [Specific improvement 2]
[Up to 5 main improvements]""",

    "grammar_correction": """\
Fix all grammar, spelling, punctuation, and syntax errors in the following text. Preserve the original style and meaning exactly.

Original text:
{text}

Respond in this EXACT format:

## Result
[The corrected text]

## Changes Made
- [Error fixed 1]
- [Error fixed 2]
[List all corrections, or "- No errors found" if already correct]""",

    "expand_section": """\
Expand the following text with more detail, context, examples, and explanation. Make it more comprehensive while staying on-topic.

Original text:
{text}
{context_block}
Respond in this EXACT format:

## Result
[Your expanded version]

## Changes Made
- [What was added or expanded 1]
- [What was added or expanded 2]
[Up to 5 main additions]""",

    "shorten_section": """\
Condense the following text to be more concise and direct. Remove redundancy and unnecessary words while keeping all key information.

Original text:
{text}

Respond in this EXACT format:

## Result
[Your condensed version]

## Changes Made
- [What was removed or condensed 1]
- [What was removed or condensed 2]
[Up to 5 main reductions]""",
}


def parse_writing_assist_response(text: str, action: str) -> dict:
    """Parse the structured AI response into action/result/changes."""
    result: dict[str, str | list[str]] = {
        "action": action,
        "result": "",
        "changes": [],
    }

    section: str | None = None
    result_lines: list[str] = []

    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if stripped.startswith("## Result"):
            section = "result"
            continue
        if stripped.startswith("## Changes"):
            section = "changes"
            continue

        if section == "result":
            result_lines.append(raw_line)
        elif section == "changes" and stripped.startswith("- "):
            change = stripped[2:].strip()
            if change and change.lower() not in ("none", "no errors found", "n/a", "-"):
                cast = result["changes"]
                if isinstance(cast, list):
                    cast.append(change)

    result["result"] = "\n".join(result_lines).strip()
    return result


async def stream_writing_assist(
    action: str,
    selected_text: str,
    context: str | None,
) -> AsyncGenerator[str, None]:
    """
    Yield SSE data lines for a writing-assist action.

    Events:
      data: {"text": "..."}
      data: {"type": "done", "action": "...", "result": "...", "changes": [...]}
      data: {"type": "error", "message": "..."}
    """
    if not settings.OPENAI_API_KEY:
        yield _err("OpenAI API key not configured — add OPENAI_API_KEY to .env")
        return

    if not selected_text.strip():
        yield _err("No text provided to transform")
        return

    template = _WRITING_PROMPTS.get(action)
    if not template:
        yield _err(f"Unknown action: {action}")
        return

    try:
        from openai import AsyncOpenAI
    except ImportError:
        yield _err("openai package not installed")
        return

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    context_block = (
        f"\nContext (surrounding text):\n{context[:2_000]}\n"
        if context and context.strip()
        else ""
    )

    prompt = template.format(
        text=selected_text[:8_000],
        context_block=context_block,
    )

    full_text = ""
    try:
        stream = await client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": _WRITING_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            stream=True,
            max_tokens=2_000,
            temperature=0.4,
        )

        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                full_text += delta
                yield f"data: {json.dumps({'text': delta})}\n\n"

        parsed = parse_writing_assist_response(full_text, action)
        yield f"data: {json.dumps({'type': 'done', **parsed})}\n\n"

    except Exception as exc:  # noqa: BLE001
        logger.exception("AI writing assist error")
        msg = str(exc)[:300] if settings.DEBUG else "Writing assist failed. Try again."
        yield _err(msg)
