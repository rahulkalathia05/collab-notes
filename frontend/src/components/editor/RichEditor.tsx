'use client';

import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import type * as Y from 'yjs';
import { EditorToolbar } from './EditorToolbar';
import { createExtensions, createCollabExtensions } from '@/lib/tiptap';
import { cn } from '@/lib/utils';

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

// ── Solo (non-collaborative) editor ──────────────────────────────────────────

interface SoloProps {
  mode?: 'solo';
  content: Record<string, unknown> | null | undefined;
  onChange: (content: Record<string, unknown>) => void;
  editable?: boolean;
  placeholder?: string;
  className?: string;
  onEditorReady?: (editor: Editor) => void;
}

// ── Collaborative editor ──────────────────────────────────────────────────────

interface CollabProps {
  mode: 'collab';
  ydoc: Y.Doc;
  provider: { awareness: { on: Function; off: Function; states: Map<number, unknown>; setLocalStateField: Function } };
  user: { name: string; color: string };
  /** onChange is optional in collab mode — Yjs manages persistence externally. */
  onChange?: (content: Record<string, unknown>) => void;
  editable?: boolean;
  placeholder?: string;
  className?: string;
  onEditorReady?: (editor: Editor) => void;
}

type RichEditorProps = SoloProps | CollabProps;

/**
 * Reusable rich-text editor built on TipTap 3.
 *
 * modes:
 *   "solo"   (default) — JSON content in/out, local undo/redo
 *   "collab"            — Yjs document + provider, collaborative undo/redo
 *
 * Always mount with `key={noteId}` so React remounts (fresh editor + Y.Doc)
 * when navigating between notes.
 */
export function RichEditor(props: RichEditorProps) {
  const {
    editable = true,
    placeholder,
    className,
  } = props;

  // In solo mode, track last synced content to skip no-op setContent calls
  const syncedContentRef = useRef(
    props.mode !== 'collab' ? JSON.stringify(props.content ?? EMPTY_DOC) : ''
  );

  const extensions =
    props.mode === 'collab'
      ? createCollabExtensions({
          ydoc: props.ydoc,
          provider: props.provider as Parameters<typeof createCollabExtensions>[0]['provider'],
          user: props.user,
          placeholder,
        })
      : createExtensions({ placeholder });

  const editor = useEditor({
    extensions,
    // In collab mode Yjs manages the document — don't pass content
    content: props.mode === 'collab' ? undefined : (props.content ?? EMPTY_DOC),
    editable,
    immediatelyRender: false,
    onUpdate({ editor }) {
      const json = editor.getJSON() as Record<string, unknown>;
      if (props.mode === 'collab') {
        props.onChange?.(json);
      } else {
        props.onChange(json);
      }
    },
  });

  // ── expose editor instance to parent via callback ────────────────────────
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      props.onEditorReady?.(editor);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── solo: sync external content changes (version restore) ────────────────
  useEffect(() => {
    if (!editor || editor.isDestroyed || props.mode === 'collab') return;
    const incoming = JSON.stringify(props.content ?? EMPTY_DOC);
    if (incoming === syncedContentRef.current) return;
    syncedContentRef.current = incoming;
    editor.commands.setContent(props.content ?? EMPTY_DOC, { emitUpdate: false });
  }, [editor, props]);

  // ── sync editable flag ───────────────────────────────────────────────────
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable);
  }, [editor, editable]);

  return (
    <div className={cn('flex flex-col', className)}>
      {editable && editor && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} className="rich-editor flex-1" />
    </div>
  );
}
