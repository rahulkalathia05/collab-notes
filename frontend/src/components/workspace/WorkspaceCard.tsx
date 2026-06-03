'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal, Pencil, Trash2, Users } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EditWorkspaceDialog } from './EditWorkspaceDialog';
import { workspaceService } from '@/services/workspaceService';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Workspace } from '@/types';
import { toast } from 'sonner';

interface WorkspaceCardProps {
  workspace: Workspace;
}

const canEdit = (role: Workspace['role']) => role === 'owner' || role === 'admin';
const canDelete = (role: Workspace['role']) => role === 'owner';

export function WorkspaceCard({ workspace }: WorkspaceCardProps) {
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const showMenu = canEdit(workspace.role) || canDelete(workspace.role);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await workspaceService.delete(workspace.id);
      removeWorkspace(workspace.id);
      setDeleteOpen(false);
      toast.success(`"${workspace.name}" deleted`);
    } catch {
      toast.error('Failed to delete workspace');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="group relative hover:bg-accent/50 transition-colors h-full">
        {/* Clickable area for navigation */}
        <Link href={`/workspaces/${workspace.id}`} className="absolute inset-0 z-0" />

        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <span className="text-2xl leading-none">{workspace.icon ?? '📁'}</span>
            <div className="flex items-center gap-1">
              <Badge variant="secondary" className="text-xs capitalize">
                {workspace.role}
              </Badge>
              {showMenu && (
                // z-10 lifts the menu above the Link overlay
                <div className="z-10 relative" onClick={(e) => e.preventDefault()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      }
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canEdit(workspace.role) && (
                        <DropdownMenuItem onClick={() => setEditOpen(true)}>
                          <Pencil className="w-3.5 h-3.5 mr-2" />
                          Edit
                        </DropdownMenuItem>
                      )}
                      {canEdit(workspace.role) && canDelete(workspace.role) && (
                        <DropdownMenuSeparator />
                      )}
                      {canDelete(workspace.role) && (
                        <DropdownMenuItem
                          onClick={() => setDeleteOpen(true)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <h3 className="font-medium truncate text-sm">{workspace.name}</h3>
          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
            <Users className="w-3 h-3" />
            <span>
              {workspace.member_count} member{workspace.member_count !== 1 ? 's' : ''}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      {canEdit(workspace.role) && (
        <EditWorkspaceDialog
          workspace={workspace}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}

      {/* Delete confirmation dialog */}
      {canDelete(workspace.role) && (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete workspace?</DialogTitle>
              <DialogDescription>
                <strong>"{workspace.name}"</strong> and all its notes will be permanently deleted.
                This cannot be undone.
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
                {deleting ? 'Deleting…' : 'Delete workspace'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
