'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  History,
  Loader2,
  Pin,
  Trash2,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
import { useCollabWS } from '@/hooks/useCollabWS';
import type { Note } from '@/types';
import { toast } from 'sonner';

interface NotePageProps {
  workspaceId: string;
  noteId: string;
}

export function NotePage({ workspaceId, noteId }: NotePageProps) {
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Tick every 15 s so "Saved X ago" updates without re-fetching
  const [tick, setTick] = useState(0);

  const titleRef = useRef<HTMLInputElement>(null);
  const { activeUsers, connected } = useCollabWS({ noteId });

  const { isSaving, isDirty, lastSavedAt, saveError, queueSave, flush } =
    useNoteSave(workspaceId, noteId, setNote);

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
        {/* Presence avatars */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
              connected ? 'bg-green-500' : 'bg-muted-foreground/30'
            }`}
          />
          {connected && activeUsers.length > 0 && (
            <div className="flex -space-x-1">
              {activeUsers.slice(0, 4).map((u) => (
                <Avatar key={u.id} className="w-5 h-5 ring-1 ring-background">
                  <AvatarImage src={u.avatar_url} />
                  <AvatarFallback
                    style={{ backgroundColor: u.color }}
                    className="text-[8px] text-white"
                  >
                    {u.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ))}
              {activeUsers.length > 4 && (
                <span className="text-xs text-muted-foreground ml-1">
                  +{activeUsers.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

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

      {/* ── editor area ───────────────────────────────────────────────── */}
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
           * Content mount point — TipTap + Yjs will replace this in Week 3.
           *
           * Wire-up (Week 3):
           *   editor.on('update', () => queueSave({ content: editor.getJSON() }));
           *
           * The `id` is stable so the TipTap integration can mount here via
           * a useEffect without touching any other part of this component.
           */}
          <div
            id="note-editor-mount"
            className="min-h-64 rounded-lg border border-dashed border-border/60 flex items-center justify-center text-muted-foreground/40 text-sm italic"
          >
            Rich text editor — Week 3
          </div>
        </div>
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
