'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  MessageSquare,
  PenLine,
  Pin,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { noteService } from '@/services/noteService';
import { useNoteSave } from '@/hooks/useNoteSave';
import { useCollabEditor } from '@/hooks/useCollabEditor';
import { useAuthStore } from '@/stores/authStore';
import { AIPanel } from './AIPanel';
import { AIWriterPanel } from './AIWriterPanel';
import { CommentsPanel, type PendingSelectionComment } from './CommentsPanel';
import { PresenceBar } from './PresenceBar';
import { RichEditor } from './RichEditor';
import { useComments } from '@/hooks/useComments';
import type { Note } from '@/types';
import { toast } from 'sonner';

interface NotePageProps {
  workspaceId: string;
  noteId: string;
}

export function NotePage({ workspaceId, noteId }: NotePageProps) {
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);

  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiWriterOpen, setAiWriterOpen] = useState(false);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<PendingSelectionComment | null>(null);
  // Tick every 15 s so "Saved X ago" updates without re-fetching
  const [tick, setTick] = useState(0);

  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [editorReady, setEditorReady] = useState(false);

  const { openCount: commentCount } = useComments(workspaceId, noteId);

  const { isSaving, isDirty, lastSavedAt, saveError, queueSave, flush } =
    useNoteSave(workspaceId, noteId, setNote);

  // ── collaborative editor (Yjs + WebSocket) ────────────────────────────────
  const { ydoc, provider, connected, activeUsers, onEditing } = useCollabEditor({
    noteId,
    currentUser,
  });

  // ── load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    setNote(null);
    setTitle('');
    setLoadError(false);
    noteService
      .get(workspaceId, noteId)
      .then((n) => {
        setNote(n);
        setTitle(n.title);
      })
      .catch(() => setLoadError(true));
  }, [workspaceId, noteId]);

  // ── keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        flush();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush]);

  // ── flush on unmount (navigating away) ───────────────────────────────────

  useEffect(() => {
    return () => { flush(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── relative-time ticker ─────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // ── handlers ─────────────────────────────────────────────────────────────

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setTitle(e.target.value);
      queueSave({ title: e.target.value || 'Untitled' });
    },
    [queueSave],
  );

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await noteService.delete(workspaceId, noteId);
      toast.success('Note deleted');
      router.push(`/workspaces/${workspaceId}`);
    } catch {
      toast.error('Failed to delete note');
      setDeleting(false);
    }
  };

  const handleSaveVersion = async () => {
    if (!note) return;
    try {
      await flush();
      await noteService.createVersion(workspaceId, noteId);
      toast.success('Version saved');
    } catch {
      toast.error('Failed to save version');
    }
  };

  const getEditorSelection = useCallback((): { text: string; from: number; to: number } | null => {
    const editor = editorRef.current;
    if (!editor) return null;
    const { from, to } = editor.state.selection;
    if (from === to) return null;
    const text = editor.state.doc.textBetween(from, to, ' ');
    return text.trim() ? { text, from, to } : null;
  }, []);

  const applyTextToEditor = useCallback((from: number, to: number, text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.chain().focus().insertContentAt({ from, to }, text).run();
  }, []);

  const jumpToSelection = useCallback((from: number, to: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.chain().focus().setTextSelection({ from, to }).run();
  }, []);

  const handlePin = async () => {
    if (!note) return;
    try {
      const updated = await noteService.pin(workspaceId, noteId);
      setNote(updated);
      toast.success(updated.is_pinned ? 'Note pinned' : 'Note unpinned');
    } catch {
      toast.error('Failed to update pin');
    }
  };

  // ── loading / error states ────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="w-6 h-6 opacity-40" />
        <p className="text-sm">Failed to load note.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(`/workspaces/${workspaceId}`)}
        >
          Back to workspace
        </Button>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  // ── main render ───────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── top bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-6 py-2 border-b bg-background shrink-0">
        {/* Live presence */}
        <PresenceBar users={activeUsers} connected={connected} />

        {/* Save status */}
        <div className="flex-1 flex justify-center">
          <SaveStatus
            isSaving={isSaving}
            isDirty={isDirty}
            saveError={saveError}
            lastSavedAt={lastSavedAt}
            tick={tick}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant={aiPanelOpen ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => { setAiPanelOpen((o) => !o); setAiWriterOpen(false); setCommentsPanelOpen(false); }}
            title="AI summarization"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1" />
            AI
          </Button>
          <Button
            variant={aiWriterOpen ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => { setAiWriterOpen((o) => !o); setAiPanelOpen(false); setCommentsPanelOpen(false); }}
            title="AI Writing Assistant"
          >
            <PenLine className="w-3.5 h-3.5 mr-1" />
            Write
          </Button>
          <Button
            variant={commentsPanelOpen ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs relative"
            onClick={() => { setCommentsPanelOpen((o) => !o); setAiPanelOpen(false); setAiWriterOpen(false); }}
            title="Comments"
          >
            <MessageSquare className="w-3.5 h-3.5 mr-1" />
            Comments
            {commentCount > 0 && !commentsPanelOpen && (
              <span className="absolute -top-1 -right-1 text-[9px] font-bold bg-primary text-primary-foreground rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
                {commentCount > 9 ? '9+' : commentCount}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={`text-muted-foreground ${note.is_pinned ? 'text-foreground' : ''}`}
            onClick={handlePin}
            title={note.is_pinned ? 'Unpin note' : 'Pin note'}
          >
            <Pin className={`w-3.5 h-3.5 ${note.is_pinned ? 'fill-current' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={handleSaveVersion}
            title="Save a named version snapshot"
          >
            <History className="w-3.5 h-3.5 mr-1" />
            Save version
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            title="Delete note"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* ── editor + AI panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-12">
          {/* Title */}
          <input
            ref={titleRef}
            value={title}
            onChange={handleTitleChange}
            placeholder="Untitled"
            className="w-full text-3xl font-bold bg-transparent border-none outline-none placeholder:text-muted-foreground/20 mb-8 leading-tight"
          />

          {/*
           * Collaborative editor — Yjs manages document state.
           * key={noteId} fully remounts on note navigation (new Y.Doc + WS).
           * The REST autosave (useNoteSave) still fires on every editor
           * update so the DB stays in sync for version history and new joiners.
           */}
          {/* BubbleMenu: "Add comment" appears on text selection */}
          {editorReady && editorRef.current && (
            <BubbleMenu
              editor={editorRef.current}
              shouldShow={({ editor }: { editor: Editor }) => {
                const { from, to } = editor.state.selection;
                return from !== to;
              }}
            >
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  const editor = editorRef.current;
                  if (!editor) return;
                  const { from, to } = editor.state.selection;
                  const text = editor.state.doc.textBetween(from, to, ' ');
                  if (!text.trim()) return;
                  setPendingSelection({ selectionFrom: from, selectionTo: to, anchorText: text });
                  setCommentsPanelOpen(true);
                  setAiPanelOpen(false);
                  setAiWriterOpen(false);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-background border shadow-md text-xs font-medium hover:bg-muted transition-colors"
              >
                <MessageSquare className="w-3 h-3" />
                Add comment
              </button>
            </BubbleMenu>
          )}

          <RichEditor
            key={noteId}
            mode="collab"
            ydoc={ydoc}
            provider={provider}
            user={{
              name: currentUser?.name ?? 'Anonymous',
              color: currentUser ? _pickColor(currentUser.id) : '#888',
            }}
            onChange={(content) => {
              queueSave({ content });
              onEditing(); // broadcast "editing" status to peers
            }}
            onEditorReady={(e) => { editorRef.current = e; setEditorReady(true); }}
            placeholder="Start writing…"
          />
          </div>
        </div>

        {/* AI summary panel — slides in from the right */}
        {aiPanelOpen && note && (
          <AIPanel
            noteId={noteId}
            workspaceId={workspaceId}
            onClose={() => setAiPanelOpen(false)}
          />
        )}

        {/* AI Writing Assistant panel */}
        {aiWriterOpen && note && (
          <AIWriterPanel
            noteId={noteId}
            workspaceId={workspaceId}
            getEditorSelection={getEditorSelection}
            applyTextToEditor={applyTextToEditor}
            onClose={() => setAiWriterOpen(false)}
          />
        )}

        {/* Comments panel */}
        {commentsPanelOpen && note && (
          <CommentsPanel
            noteId={noteId}
            workspaceId={workspaceId}
            pendingSelection={pendingSelection}
            onClearPending={() => setPendingSelection(null)}
            onJumpToSelection={jumpToSelection}
            onClose={() => { setCommentsPanelOpen(false); setPendingSelection(null); }}
          />
        )}
      </div>

      {/* ── delete confirmation ───────────────────────────────────────── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete note?</DialogTitle>
            <DialogDescription>
              <strong>"{note.title}"</strong> will be permanently deleted. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete note'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── SaveStatus ────────────────────────────────────────────────────────────────

function SaveStatus({
  isSaving,
  isDirty,
  saveError,
  lastSavedAt,
  tick,
}: {
  isSaving: boolean;
  isDirty: boolean;
  saveError: string | null;
  lastSavedAt: Date | null;
  tick: number;
}) {
  if (isSaving) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (saveError) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <AlertCircle className="w-3 h-3" />
        {saveError}
      </span>
    );
  }
  if (isDirty) {
    return <span className="text-xs text-muted-foreground/60">Unsaved changes</span>;
  }
  if (lastSavedAt) {
    // `tick` is unused but forces a re-render every 15 s
    void tick;
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
        <CheckCircle2 className="w-3 h-3" />
        Saved {relativeTime(lastSavedAt)}
      </span>
    );
  }
  return null;
}

function relativeTime(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : 'a while ago';
}

const _CURSOR_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
];

function _pickColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = userId.charCodeAt(i) + ((h << 5) - h);
  return _CURSOR_COLORS[Math.abs(h) % _CURSOR_COLORS.length];
}
