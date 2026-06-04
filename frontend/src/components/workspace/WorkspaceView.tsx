'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart2, Clock, FileText, Pin, Plus, Trash2, Users } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MembersDialog } from './MembersDialog';
import { noteService } from '@/services/noteService';
import { workspaceService } from '@/services/workspaceService';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Note, Workspace } from '@/types';
import { toast } from 'sonner';

export function WorkspaceView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);

  useEffect(() => {
    workspaceService.get(workspaceId).then((ws) => {
      setWorkspace(ws);
      setActiveWorkspace(ws);
    });
    noteService.list(workspaceId).then(setNotes);
  }, [workspaceId, setActiveWorkspace]);

  const handleCreateNote = async () => {
    setCreating(true);
    try {
      const note = await noteService.create(workspaceId, { title: 'Untitled' });
      router.push(`/workspaces/${workspaceId}/notes/${note.id}`);
    } catch {
      toast.error('Failed to create note');
      setCreating(false);
    }
  };

  const handlePin = async (noteId: string) => {
    try {
      const updated = await noteService.pin(workspaceId, noteId);
      setNotes((prev) => {
        const next = prev.map((n) => (n.id === noteId ? updated : n));
        // Re-sort: pinned first, then by updated_at
        return next.sort(
          (a, b) => Number(b.is_pinned) - Number(a.is_pinned) ||
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      });
    } catch {
      toast.error('Failed to update pin');
    }
  };

  const handleDelete = async (noteId: string) => {
    try {
      await noteService.delete(workspaceId, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setDeletingId(null);
      toast.success('Note deleted');
    } catch {
      toast.error('Failed to delete note');
    }
  };

  const noteToDelete = notes.find((n) => n.id === deletingId);
  const pinnedNotes = notes.filter((n) => n.is_pinned);
  const unpinnedNotes = notes.filter((n) => !n.is_pinned);

  return (
    <>
      <Header
        title={workspace?.name ?? 'Loading…'}
        description={workspace ? `${notes.length} note${notes.length !== 1 ? 's' : ''}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMembersOpen(true)}
              title="Manage members"
            >
              <Users className="w-3.5 h-3.5 mr-1" />
              Members
            </Button>
            <a
              href={`/workspaces/${workspaceId}/analytics`}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="View analytics"
            >
              <BarChart2 className="w-3.5 h-3.5" />
              Analytics
            </a>
            <Button size="sm" onClick={handleCreateNote} disabled={creating}>
              <Plus className="w-3.5 h-3.5" />
              New Note
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <FileText className="w-8 h-8 opacity-20" />
            <p className="text-sm">No notes yet</p>
            <Button variant="outline" size="sm" onClick={handleCreateNote} disabled={creating}>
              Create your first note
            </Button>
          </div>
        ) : (
          <div className="max-w-2xl space-y-4">
            {/* Pinned section */}
            {pinnedNotes.length > 0 && (
              <section>
                <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wide px-3 mb-1">
                  Pinned
                </p>
                <div className="space-y-0.5">
                  {pinnedNotes.map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      workspaceId={workspaceId}
                      onPin={handlePin}
                      onDelete={setDeletingId}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* All other notes */}
            {unpinnedNotes.length > 0 && (
              <section>
                {pinnedNotes.length > 0 && (
                  <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wide px-3 mb-1">
                    Notes
                  </p>
                )}
                <div className="space-y-0.5">
                  {unpinnedNotes.map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      workspaceId={workspaceId}
                      onPin={handlePin}
                      onDelete={setDeletingId}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Members / sharing dialog */}
      {workspace && (
        <MembersDialog
          workspaceId={workspaceId}
          workspaceName={workspace.name}
          open={membersOpen}
          onOpenChange={setMembersOpen}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete note?</DialogTitle>
            <DialogDescription>
              <strong>"{noteToDelete?.title}"</strong> will be permanently deleted.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeletingId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deletingId && handleDelete(deletingId)}
            >
              Delete note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── NoteRow ───────────────────────────────────────────────────────────────────

function NoteRow({
  note,
  workspaceId,
  onPin,
  onDelete,
}: {
  note: Note;
  workspaceId: string;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="group flex items-center rounded-lg hover:bg-accent transition-colors">
      <Link
        href={`/workspaces/${workspaceId}/notes/${note.id}`}
        className="flex-1 flex items-center gap-3 px-3 py-2 min-w-0"
      >
        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="flex-1 truncate text-sm font-medium">
          {note.title || 'Untitled'}
        </span>
        <span className="text-xs text-muted-foreground flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Clock className="w-3 h-3" />
          {new Date(note.updated_at).toLocaleDateString()}
        </span>
      </Link>

      {/* Row actions — visible on hover */}
      <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon-sm"
          className={`h-6 w-6 text-muted-foreground ${note.is_pinned ? 'text-foreground' : ''}`}
          onClick={(e) => { e.preventDefault(); onPin(note.id); }}
          title={note.is_pinned ? 'Unpin' : 'Pin'}
        >
          <Pin className={`w-3 h-3 ${note.is_pinned ? 'fill-current' : ''}`} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.preventDefault(); onDelete(note.id); }}
          title="Delete note"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
