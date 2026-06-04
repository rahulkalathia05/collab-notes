'use client';

import { useCallback, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Clock,
  GitCompare,
  History,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useVersions } from '@/hooks/useVersions';
import { diffTexts, diffStats, type DiffLine } from '@/lib/diff';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { NoteVersion } from '@/types';

// ── types ─────────────────────────────────────────────────────────────────────

type PanelMode =
  | { kind: 'list' }
  | { kind: 'preview'; version: NoteVersion }
  | { kind: 'compare'; version: NoteVersion };

interface VersionHistoryPanelProps {
  workspaceId: string;
  noteId: string;
  /** Plain text of the current (live) note — used for comparison */
  currentContentText: string;
  /** Called after a restore so the parent can reload editor content */
  onRestored: (note: { content?: Record<string, unknown>; content_text?: string }) => void;
  onClose: () => void;
}

// ── panel ─────────────────────────────────────────────────────────────────────

export function VersionHistoryPanel({
  workspaceId,
  noteId,
  currentContentText,
  onRestored,
  onClose,
}: VersionHistoryPanelProps) {
  const { versions, isLoading, save, rename, remove, restore } = useVersions(
    workspaceId,
    noteId,
  );

  const [mode, setMode] = useState<PanelMode>({ kind: 'list' });
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [saving, setSaving] = useState(false);

  // ── save snapshot form ────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await save.mutateAsync(saveLabel.trim() || undefined);
      setSaveLabel('');
      setSaveOpen(false);
      toast.success('Snapshot saved');
    } catch {
      toast.error('Failed to save snapshot');
    } finally {
      setSaving(false);
    }
  }, [save, saveLabel]);

  // ── restore ───────────────────────────────────────────────────────────────

  const handleRestore = useCallback(
    async (version: NoteVersion) => {
      try {
        const note = await restore.mutateAsync(version.id);
        onRestored(note);
        setMode({ kind: 'list' });
        toast.success('Restored to version');
      } catch {
        toast.error('Failed to restore version');
      }
    },
    [restore, onRestored],
  );

  // ── header title by mode ──────────────────────────────────────────────────

  const title =
    mode.kind === 'preview'
      ? 'Version Preview'
      : mode.kind === 'compare'
        ? 'Compare Versions'
        : 'Version History';

  return (
    <aside className="flex flex-col w-80 shrink-0 border-l bg-background overflow-hidden animate-in slide-in-from-right-4 duration-200">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          {mode.kind !== 'list' && (
            <button
              onClick={() => setMode({ kind: 'list' })}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          {mode.kind === 'list' && <History className="w-4 h-4 text-primary" />}
          {mode.kind === 'compare' && <GitCompare className="w-4 h-4 text-primary" />}
          <span className="text-sm font-medium">{title}</span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* ── Mode: list ── */}
      {mode.kind === 'list' && (
        <ListMode
          versions={versions}
          isLoading={isLoading}
          saveOpen={saveOpen}
          saveLabel={saveLabel}
          saving={saving}
          onSaveLabelChange={setSaveLabel}
          onSaveOpen={() => setSaveOpen(true)}
          onSaveCancel={() => { setSaveOpen(false); setSaveLabel(''); }}
          onSave={handleSave}
          onPreview={(v) => setMode({ kind: 'preview', version: v })}
          onCompare={(v) => setMode({ kind: 'compare', version: v })}
          onRestore={handleRestore}
          onRename={rename.mutateAsync}
          onDelete={remove.mutateAsync}
        />
      )}

      {/* ── Mode: preview ── */}
      {mode.kind === 'preview' && (
        <PreviewMode
          version={mode.version}
          onRestore={() => handleRestore(mode.version)}
          onCompare={() => setMode({ kind: 'compare', version: mode.version })}
          restoring={restore.isPending}
        />
      )}

      {/* ── Mode: compare ── */}
      {mode.kind === 'compare' && (
        <CompareMode
          version={mode.version}
          currentText={currentContentText}
          onRestore={() => handleRestore(mode.version)}
          restoring={restore.isPending}
        />
      )}
    </aside>
  );
}

// ── ListMode ──────────────────────────────────────────────────────────────────

function ListMode({
  versions,
  isLoading,
  saveOpen,
  saveLabel,
  saving,
  onSaveLabelChange,
  onSaveOpen,
  onSaveCancel,
  onSave,
  onPreview,
  onCompare,
  onRestore,
  onRename,
  onDelete,
}: {
  versions: NoteVersion[];
  isLoading: boolean;
  saveOpen: boolean;
  saveLabel: string;
  saving: boolean;
  onSaveLabelChange: (v: string) => void;
  onSaveOpen: () => void;
  onSaveCancel: () => void;
  onSave: () => void;
  onPreview: (v: NoteVersion) => void;
  onCompare: (v: NoteVersion) => void;
  onRestore: (v: NoteVersion) => void;
  onRename: (args: { versionId: string; label: string }) => Promise<NoteVersion>;
  onDelete: (versionId: string) => Promise<void>;
}) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Save snapshot section */}
      <div className="px-3 py-2 shrink-0">
        {saveOpen ? (
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="Label (optional)"
              value={saveLabel}
              onChange={(e) => onSaveLabelChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSave();
                if (e.key === 'Escape') onSaveCancel();
              }}
            />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 h-7 text-xs" onClick={onSave} disabled={saving}>
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Save snapshot
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onSaveCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={onSaveOpen}>
            <Plus className="w-3 h-3 mr-1" />
            Save snapshot
          </Button>
        )}
      </div>

      <Separator />

      {/* Version timeline */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading…
          </div>
        )}

        {!isLoading && versions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground px-4 text-center">
            <History className="w-6 h-6 opacity-20" />
            <p className="text-xs">No snapshots yet. Save one to start tracking history.</p>
          </div>
        )}

        {/* Current marker */}
        {!isLoading && versions.length > 0 && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="font-medium text-foreground">Current version</span>
              <span className="ml-auto">now</span>
            </div>
          </div>
        )}

        {/* Version list */}
        <div className="divide-y">
          {versions.map((v) => (
            <VersionRow
              key={v.id}
              version={v}
              onPreview={() => onPreview(v)}
              onCompare={() => onCompare(v)}
              onRestore={() => onRestore(v)}
              onRename={async (label) => { await onRename({ versionId: v.id, label }); }}
              onDelete={async () => { await onDelete(v.id); }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── VersionRow ────────────────────────────────────────────────────────────────

function VersionRow({
  version,
  onPreview,
  onCompare,
  onRestore,
  onRename,
  onDelete,
}: {
  version: NoteVersion;
  onPreview: () => void;
  onCompare: () => void;
  onRestore: () => void;
  onRename: (label: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(version.label ?? '');
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleRename = async () => {
    if (!editLabel.trim()) return;
    setRenaming(true);
    try {
      await onRename(editLabel.trim());
      setEditing(false);
      toast.success('Label updated');
    } catch {
      toast.error('Failed to update label');
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await onDelete();
      toast.success('Snapshot deleted');
    } catch {
      toast.error('Failed to delete snapshot');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const isAutomatic = version.label?.startsWith('Before restore');

  return (
    <div className="px-3 py-3 group hover:bg-muted/30 transition-colors">
      {/* Timeline dot + meta */}
      <div className="flex items-start gap-2.5">
        <div className="flex flex-col items-center shrink-0 mt-0.5">
          <span
            className={cn(
              'w-2 h-2 rounded-full border-2 shrink-0',
              isAutomatic
                ? 'border-amber-400 bg-amber-100 dark:bg-amber-950/40'
                : 'border-primary/60 bg-primary/10',
            )}
          />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          {/* Label / edit inline */}
          {editing ? (
            <div className="flex gap-1">
              <Input
                autoFocus
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') { setEditing(false); setEditLabel(version.label ?? ''); }
                }}
                className="h-6 text-xs px-2"
              />
              <button
                onClick={handleRename}
                disabled={renaming}
                className="text-primary hover:text-primary/80"
              >
                {renaming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              </button>
            </div>
          ) : (
            <button
              onClick={onPreview}
              className="text-left w-full group/label"
            >
              <span className="text-xs font-medium leading-tight line-clamp-2 group-hover/label:text-primary transition-colors">
                {version.label || 'Unnamed snapshot'}
              </span>
            </button>
          )}

          {/* Author + timestamp */}
          <div className="flex items-center gap-1.5">
            <UserDot name={version.snapshotter.name} />
            <span className="text-[10px] text-muted-foreground truncate">
              {version.snapshotter.name}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
              {formatDate(version.created_at)}
            </span>
          </div>

          {/* Actions — shown on hover */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
            <ActionBtn onClick={onPreview} title="Preview" icon={<Clock className="w-3 h-3" />} label="Preview" />
            <ActionBtn onClick={onCompare} title="Compare with current" icon={<GitCompare className="w-3 h-3" />} label="Diff" />
            <ActionBtn onClick={onRestore} title="Restore this version" icon={<RotateCcw className="w-3 h-3" />} label="Restore" />
            {!isAutomatic && (
              <ActionBtn
                onClick={() => { setEditing(true); setEditLabel(version.label ?? ''); }}
                title="Rename"
                icon={<Pencil className="w-3 h-3" />}
              />
            )}
            <button
              onClick={handleDelete}
              onBlur={() => setConfirmDelete(false)}
              disabled={deleting}
              title={confirmDelete ? 'Click again to confirm' : 'Delete snapshot'}
              className={cn(
                'flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] transition-colors',
                confirmDelete
                  ? 'bg-destructive/10 text-destructive'
                  : 'text-muted-foreground hover:text-destructive hover:bg-muted',
              )}
            >
              {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              {confirmDelete && 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({
  onClick,
  title,
  icon,
  label,
}: {
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {icon}
      {label}
    </button>
  );
}

// ── PreviewMode ───────────────────────────────────────────────────────────────

function PreviewMode({
  version,
  onRestore,
  onCompare,
  restoring,
}: {
  version: NoteVersion;
  onRestore: () => void;
  onCompare: () => void;
  restoring: boolean;
}) {
  const text = version.content_text ?? extractTextFromTiptap(version.content);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Meta */}
      <div className="px-4 py-3 space-y-1 shrink-0 border-b">
        <p className="text-xs font-medium">{version.label || 'Unnamed snapshot'}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <UserDot name={version.snapshotter.name} />
          {version.snapshotter.name} · {formatDate(version.created_at)}
        </div>
        <div className="flex gap-2 pt-1">
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={onRestore} disabled={restoring}>
            {restoring ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
            Restore
          </Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={onCompare}>
            <GitCompare className="w-3 h-3 mr-1" />
            Compare
          </Button>
        </div>
      </div>

      {/* Content preview */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Content
        </p>
        <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-muted/20 rounded-md p-3 font-mono text-[11px]">
          {text || <span className="italic opacity-50">Empty note</span>}
        </div>
      </div>
    </div>
  );
}

// ── CompareMode ───────────────────────────────────────────────────────────────

function CompareMode({
  version,
  currentText,
  onRestore,
  restoring,
}: {
  version: NoteVersion;
  currentText: string;
  onRestore: () => void;
  restoring: boolean;
}) {
  const oldText = version.content_text ?? extractTextFromTiptap(version.content);
  const diffLines = diffTexts(oldText, currentText);
  const stats = diffStats(diffLines);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b shrink-0 space-y-2">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{version.label || 'Snapshot'}</span>
          {' → '}
          <span className="font-medium text-foreground">Current</span>
        </div>
        {/* Stats */}
        <div className="flex items-center gap-3 text-[10px]">
          {stats.added > 0 && (
            <span className="text-emerald-600 font-medium">+{stats.added} lines</span>
          )}
          {stats.removed > 0 && (
            <span className="text-red-500 font-medium">−{stats.removed} lines</span>
          )}
          {stats.added === 0 && stats.removed === 0 && (
            <span className="text-muted-foreground">No changes</span>
          )}
        </div>
        <Button size="sm" className="w-full h-7 text-xs" onClick={onRestore} disabled={restoring}>
          {restoring ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
          Restore this version
        </Button>
      </div>

      {/* Diff view */}
      <div className="flex-1 overflow-y-auto p-3">
        {diffLines.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">Versions are identical</p>
        )}
        <div className="font-mono text-[11px] leading-relaxed space-y-px">
          {diffLines.map((line, i) => (
            <DiffLineRow key={i} line={line} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === 'same') {
    return (
      <div className="flex items-start gap-1.5 text-muted-foreground/70 px-1 py-px">
        <span className="w-3 shrink-0 select-none text-center"> </span>
        <span className="whitespace-pre-wrap break-words min-w-0">{line.text || '​'}</span>
      </div>
    );
  }

  const isAdd = line.type === 'add';
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 rounded px-1 py-px',
        isAdd
          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
          : 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300',
      )}
    >
      <span className="w-3 shrink-0 select-none text-center font-bold">
        {isAdd ? '+' : '−'}
      </span>
      <span className="whitespace-pre-wrap break-words min-w-0">
        {line.spans ? (
          line.spans.map((span, i) => (
            <span
              key={i}
              className={
                span.type !== 'same'
                  ? isAdd
                    ? 'bg-emerald-200 dark:bg-emerald-800/50 rounded-sm'
                    : 'bg-red-200 dark:bg-red-800/50 rounded-sm'
                  : undefined
              }
            >
              {span.text}
            </span>
          ))
        ) : (
          line.text || '​'
        )}
      </span>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function UserDot({ name }: { name: string }) {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span
      className="w-3 h-3 rounded-full shrink-0 inline-block"
      style={{ backgroundColor: `hsl(${hue}, 55%, 50%)` }}
      title={name}
    />
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) {
    return d.toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Minimal text extractor for TipTap JSON — fallback when content_text is absent. */
function extractTextFromTiptap(doc: Record<string, unknown> | null | undefined): string {
  if (!doc) return '';
  const parts: string[] = [];
  function walk(node: Record<string, unknown>) {
    if (node.type === 'text') { parts.push((node.text as string) ?? ''); return; }
    if (node.type === 'hardBreak') { parts.push('\n'); return; }
    for (const child of (node.content as Record<string, unknown>[] | undefined) ?? []) walk(child);
    if (['paragraph', 'heading', 'blockquote'].includes(node.type as string)) parts.push('\n');
  }
  walk(doc);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}
