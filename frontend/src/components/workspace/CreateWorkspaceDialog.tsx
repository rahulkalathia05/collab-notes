'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
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
import { toast } from 'sonner';

export function CreateWorkspaceDialog() {
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📁');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const ws = await workspaceService.create({ name: name.trim(), icon });
      addWorkspace(ws);
      setOpen(false);
      setName('');
      setIcon('📁');
      toast.success(`"${ws.name}" created`);
    } catch {
      toast.error('Failed to create workspace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="w-3.5 h-3.5" />
        New Workspace
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>
              Workspaces organize your notes and collaborators.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-1">
            <div className="flex gap-3">
              <div className="space-y-1.5 w-20 shrink-0">
                <Label htmlFor="ws-icon">Icon</Label>
                <Input
                  id="ws-icon"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  placeholder="📁"
                />
              </div>
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="ws-name">Name</Label>
                <Input
                  id="ws-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My workspace"
                  autoFocus
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading || !name.trim()}>
                {loading ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
