'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { workspaceService } from '@/services/workspaceService';
import type { WorkspaceMember } from '@/types';

function key(workspaceId: string) {
  return ['members', workspaceId] as const;
}

export function useMembers(workspaceId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: key(workspaceId),
    queryFn: () => workspaceService.listMembers(workspaceId),
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key(workspaceId) });

  const invite = useMutation({
    mutationFn: ({ email, role }: { email: string; role: WorkspaceMember['role'] }) =>
      workspaceService.inviteMember(workspaceId, { email, role }),
    onSuccess: (member) => {
      qc.setQueryData<WorkspaceMember[]>(key(workspaceId), (old = []) => [...old, member]);
    },
  });

  const updateRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceMember['role'] }) =>
      workspaceService.updateMemberRole(workspaceId, userId, role),
    onSuccess: (updated) => {
      qc.setQueryData<WorkspaceMember[]>(key(workspaceId), (old = []) =>
        old.map((m) => (m.user.id === updated.user.id ? updated : m)),
      );
    },
  });

  const remove = useMutation({
    mutationFn: (userId: string) => workspaceService.removeMember(workspaceId, userId),
    onSuccess: (_, userId) => {
      qc.setQueryData<WorkspaceMember[]>(key(workspaceId), (old = []) =>
        old.filter((m) => m.user.id !== userId),
      );
    },
  });

  return {
    members: query.data ?? [],
    isLoading: query.isLoading,
    refetch: invalidate,
    invite,
    updateRole,
    remove,
  };
}
