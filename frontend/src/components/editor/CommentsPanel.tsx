'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RotateCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useComments } from '@/hooks/useComments';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Comment } from '@/types';

// ── types ─────────────────────────────────────────────────────────────────────

type Filter = 'all' | 'open' | 'resolved';

export interface PendingSelectionComment {
  selectionFrom: number;
  selectionTo: number;
  anchorText: string;
}

interface CommentsPanelProps {
  workspaceId: string;
  noteId: string;
  /** When set, the panel auto-opens a new-comment form for a selection */
  pendingSelection: PendingSelectionComment | null;
  onClearPending: () => void;
  /** Jump editor cursor to a selection comment's position */
  onJumpToSelection: (from: number, to: number) => void;
  onClose: () => void;
}

// ── main panel ────────────────────────────────────────────────────────────────

export function CommentsPanel({
  workspaceId,
  noteId,
  pendingSelection,
  onClearPending,
  onJumpToSelection,
  onClose,
}: CommentsPanelProps) {
  const currentUser = useAuthStore((s) => s.user);
  const { comments, isLoading, addComment, addReply, resolve, remove } = useComments(
    workspaceId,
    noteId,
  );

  const [filter, setFilter] = useState<Filter>('open');
  const [newText, setNewText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const newInputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus new comment form when a pending selection arrives
  useEffect(() => {
    if (pendingSelection) {
      setFilter('open');
      setTimeout(() => newInputRef.current?.focus(), 100);
    }
  }, [pendingSelection]);

  const handleAddComment = useCallback(async () => {
    if (!newText.trim()) return;
    setSubmitting(true);
    try {
      await addComment.mutateAsync(
        pendingSelection
          ? {
              content: newText.trim(),
              comment_type: 'selection',
              selection_from: pendingSelection.selectionFrom,
              selection_to: pendingSelection.selectionTo,
              anchor_text: pendingSelection.anchorText,
            }
          : { content: newText.trim(), comment_type: 'note' },
      );
      setNewText('');
      onClearPending();
    } catch {
      toast.error('Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  }, [newText, pendingSelection, addComment, onClearPending]);

  const filtered = comments.filter((c) => {
    if (filter === 'open') return !c.resolved;
    if (filter === 'resolved') return c.resolved;
    return true;
  });

  const openCount = comments.filter((c) => !c.resolved).length;

  return (
    <aside className="flex flex-col w-80 shrink-0 border-l bg-background overflow-hidden animate-in slide-in-from-right-4 duration-200">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Comments</span>
          {openCount > 0 && (
            <span className="text-[10px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 leading-none">
              {openCount}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex gap-1 px-3 pt-2 pb-1 shrink-0">
        {(['open', 'resolved', 'all'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors',
              filter === f
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* ── New comment / selection comment form ── */}
      <div className="px-3 pb-2 shrink-0">
        {pendingSelection && (
          <div className="mb-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs">
            <p className="text-muted-foreground mb-0.5 font-medium">Selected text</p>
            <p className="italic text-foreground/70 line-clamp-2">"{pendingSelection.anchorText}"</p>
            <button
              onClick={onClearPending}
              className="mt-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear selection
            </button>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <textarea
            ref={newInputRef}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddComment();
            }}
            placeholder={
              pendingSelection ? 'Comment on selection… (⌘↵ to post)' : 'Add a note-level comment…'
            }
            rows={3}
            className="w-full resize-none rounded-md border bg-muted/20 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <Button
            size="sm"
            className="w-full h-7 text-xs"
            onClick={handleAddComment}
            disabled={!newText.trim() || submitting}
          >
            {submitting ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
            ) : (
              <Send className="w-3 h-3 mr-1.5" />
            )}
            {pendingSelection ? 'Comment on selection' : 'Post comment'}
          </Button>
        </div>
      </div>

      <Separator />

      {/* ── Comments list ── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
            <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
            Loading…
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-muted-foreground text-sm px-4 text-center">
            <MessageSquare className="w-5 h-5 opacity-30" />
            <p className="text-xs">
              {filter === 'resolved' ? 'No resolved comments' : 'No comments yet'}
            </p>
          </div>
        )}

        <div className="divide-y">
          {filtered.map((comment) => (
            <CommentThread
              key={comment.id}
              comment={comment}
              currentUserId={currentUser?.id}
              onResolve={(id) => resolve.mutate(id)}
              onDelete={(id) => remove.mutate(id)}
              onReply={(id, content) => addReply.mutate({ commentId: id, content })}
              onJump={
                comment.comment_type === 'selection' &&
                comment.selection_from != null &&
                comment.selection_to != null
                  ? () => onJumpToSelection(comment.selection_from!, comment.selection_to!)
                  : undefined
              }
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── CommentThread ─────────────────────────────────────────────────────────────

function CommentThread({
  comment,
  currentUserId,
  onResolve,
  onDelete,
  onReply,
  onJump,
}: {
  comment: Comment;
  currentUserId?: string;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onReply: (id: string, content: string) => void;
  onJump?: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      await onReply(comment.id, replyText.trim());
      setReplyText('');
      setReplying(false);
    } catch {
      toast.error('Failed to post reply');
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <div className={cn('px-3 py-3 space-y-2', comment.resolved && 'opacity-60')}>
      {/* Selection anchor */}
      {comment.comment_type === 'selection' && comment.anchor_text && (
        <button
          onClick={onJump}
          className="w-full text-left"
          title="Jump to selection in editor"
        >
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border-l-2 border-blue-400 px-2 py-1 text-xs italic text-muted-foreground line-clamp-2 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors">
            "{comment.anchor_text}"
          </div>
        </button>
      )}

      {/* Comment header */}
      <div className="flex items-start gap-2">
        <Avatar name={comment.user.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold truncate">{comment.user.name}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {formatTime(comment.created_at)}
            </span>
            {comment.resolved && (
              <span className="text-[10px] text-green-600 flex items-center gap-0.5 shrink-0">
                <CheckCircle2 className="w-2.5 h-2.5" />
                resolved
              </span>
            )}
          </div>
          <p className="text-sm mt-1 leading-relaxed break-words">{comment.content}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => onResolve(comment.id)}
            title={comment.resolved ? 'Re-open' : 'Resolve'}
            className={cn(
              'w-5 h-5 rounded flex items-center justify-center transition-colors',
              comment.resolved
                ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30'
                : 'text-muted-foreground hover:text-green-600 hover:bg-muted',
            )}
          >
            {comment.resolved ? (
              <RotateCcw className="w-3 h-3" />
            ) : (
              <Check className="w-3 h-3" />
            )}
          </button>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
            >
              <MoreHorizontal className="w-3 h-3" />
            </button>
            {menuOpen && (
              <ContextMenu
                onClose={() => setMenuOpen(false)}
                onDelete={() => { onDelete(comment.id); setMenuOpen(false); }}
                canDelete={currentUserId === comment.user.id}
              />
            )}
          </div>
        </div>
      </div>

      {/* Replies */}
      {comment.replies.length > 0 && (
        <div className="ml-7 space-y-2">
          <button
            onClick={() => setRepliesOpen((o) => !o)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {repliesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}
          </button>

          {repliesOpen && (
            <div className="space-y-2">
              {comment.replies.map((reply) => (
                <ReplyItem
                  key={reply.id}
                  reply={reply}
                  currentUserId={currentUserId}
                  onDelete={() => onDelete(reply.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reply form */}
      {!comment.resolved && (
        <div className="ml-7">
          {replying ? (
            <div className="space-y-1.5">
              <textarea
                autoFocus
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply();
                  if (e.key === 'Escape') { setReplying(false); setReplyText(''); }
                }}
                placeholder="Reply… (⌘↵ to send)"
                rows={2}
                className="w-full resize-none rounded-md border bg-muted/20 px-2 py-1.5 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="h-6 text-[11px] px-2"
                  onClick={handleReply}
                  disabled={!replyText.trim() || sendingReply}
                >
                  {sendingReply ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : 'Reply'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[11px] px-2"
                  onClick={() => { setReplying(false); setReplyText(''); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setReplying(true)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Reply
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── ReplyItem ─────────────────────────────────────────────────────────────────

function ReplyItem({
  reply,
  currentUserId,
  onDelete,
}: {
  reply: Comment;
  currentUserId?: string;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <Avatar name={reply.user.name} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold truncate">{reply.user.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatTime(reply.created_at)}
          </span>
        </div>
        <p className="text-xs mt-0.5 leading-relaxed break-words">{reply.content}</p>
      </div>
      {currentUserId === reply.user.id && (
        <button
          onClick={onDelete}
          title="Delete reply"
          className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

// ── ContextMenu ───────────────────────────────────────────────────────────────

function ContextMenu({
  onClose,
  onDelete,
  canDelete,
}: {
  onClose: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-6 z-10 w-32 rounded-md border bg-popover shadow-md py-1 text-xs"
    >
      {canDelete ? (
        <button
          onClick={onDelete}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-destructive hover:bg-muted transition-colors"
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </button>
      ) : (
        <div className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground">
          <AlertCircle className="w-3 h-3" />
          Not your comment
        </div>
      )}
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const hue = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold shrink-0 text-white',
        size === 'sm' ? 'w-5 h-5 text-[9px]' : 'w-6 h-6 text-[10px]',
      )}
      style={{ backgroundColor: `hsl(${hue}, 60%, 45%)` }}
      title={name}
    >
      {initials}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
