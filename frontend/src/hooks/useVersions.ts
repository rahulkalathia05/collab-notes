'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { noteService } from '@/services/noteService';
import type { Note, NoteVersion } from '@/types';

function key(workspaceId: string, noteId: string) {
  return ['versions', workspaceId, noteId] as const;
}

export function useVersions(workspaceId: string, noteId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: key(workspaceId, noteId),
    queryFn: () => noteService.listVersions(workspaceId, noteId),
    staleTime: 10_000,
  });

  const save = useMutation({
    mutationFn: (label?: string) => noteService.createVersion(workspaceId, noteId, label),
    onSuccess: (v) => {
      qc.setQueryData<NoteVersion[]>(key(workspaceId, noteId), (old = []) => [v, ...old]);
    },
  });

  const rename = useMutation({
    mutationFn: ({ versionId, label }: { versionId: string; label: string }) =>
      noteService.updateVersionLabel(workspaceId, noteId, versionId, label),
    onSuccess: (updated) => {
      qc.setQueryData<NoteVersion[]>(key(workspaceId, noteId), (old = []) =>
        old.map((v) => (v.id === updated.id ? updated : v)),
      );
    },
  });

  const remove = useMutation({
    mutationFn: (versionId: string) => noteService.deleteVersion(workspaceId, noteId, versionId),
    onSuccess: (_, versionId) => {
      qc.setQueryData<NoteVersion[]>(key(workspaceId, noteId), (old = []) =>
        old.filter((v) => v.id !== versionId),
      );
    },
  });

  const restore = useMutation({
    mutationFn: (versionId: string) =>
      noteService.restoreVersion(workspaceId, noteId, versionId),
    onSuccess: () => {
      // Restoring creates a pre-restore snapshot — refetch the list
      qc.invalidateQueries({ queryKey: key(workspaceId, noteId) });
    },
  });

  return {
    versions: query.data ?? [],
    isLoading: query.isLoading,
    save,
    rename,
    remove,
    restore,
  };
}
