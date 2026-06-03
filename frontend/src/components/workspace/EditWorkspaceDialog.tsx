'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { workspaceService } from '@/services/workspaceService';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Workspace } from '@/types';
import { toast } from 'sonner';

interface EditWorkspaceDialogProps {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: EditWorkspaceDialogProps) {
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace);
  const [name, setName] = useState(workspace.name);
  const [icon, setIcon] = useState(workspace.icon ?? '📁');
  const [loading, setLoading] = useState(false);

  // Sync when the workspace prop changes (e.g. parent re-opens with new data)
  useEffect(() => {
    setName(workspace.name);
    setIcon(workspace.icon ?? '📁');
  }, [workspace.name, workspace.icon]);

  const isDirty = name.trim() !== workspace.name || icon !== (workspace.icon ?? '📁');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty) return;
    setLoading(true);
    try {
      const updated = await workspaceService.update(workspace.id, {
        name: name.trim(),
        icon,
      });
      updateWorkspace(workspace.id, updated);
      onOpenChange(false);
      toast.success('Workspace updated');
    } catch {
      toast.error('Failed to update workspace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit workspace</DialogTitle>
          <DialogDescription>Update the name or icon.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-1">
          <div className="flex gap-3">
            <div className="space-y-1.5 w-20 shrink-0">
              <Label htmlFor="edit-icon">Icon</Label>
              <Input
                id="edit-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="📁"
              />
            </div>
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Workspace name"
                autoFocus
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading || !name.trim() || !isDirty}>
              {loading ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
