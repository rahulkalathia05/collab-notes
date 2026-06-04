'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commentService, type CommentCreatePayload } from '@/services/commentService';
import type { Comment } from '@/types';

function key(workspaceId: string, noteId: string) {
  return ['comments', workspaceId, noteId] as const;
}

export function useComments(workspaceId: string, noteId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: key(workspaceId, noteId),
    queryFn: () => commentService.list(workspaceId, noteId),
    refetchInterval: 8_000,
    staleTime: 4_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key(workspaceId, noteId) });

  const addComment = useMutation({
    mutationFn: (payload: CommentCreatePayload) =>
      commentService.create(workspaceId, noteId, payload),
    onSuccess: (newComment) => {
      qc.setQueryData<Comment[]>(key(workspaceId, noteId), (old = []) => [
        ...old,
        { ...newComment, replies: [] },
      ]);
    },
  });

  const addReply = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      commentService.createReply(workspaceId, noteId, commentId, content),
    onSuccess: (reply) => {
      qc.setQueryData<Comment[]>(key(workspaceId, noteId), (old = []) =>
        old.map((c) =>
          c.id === reply.parent_id ? { ...c, replies: [...(c.replies ?? []), reply] } : c,
        ),
      );
    },
  });

  const resolve = useMutation({
    mutationFn: (commentId: string) => commentService.resolve(workspaceId, noteId, commentId),
    onSuccess: (updated) => {
      qc.setQueryData<Comment[]>(key(workspaceId, noteId), (old = []) =>
        old.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)),
      );
    },
  });

  const remove = useMutation({
    mutationFn: (commentId: string) => commentService.delete(workspaceId, noteId, commentId),
    onSuccess: (_v, commentId) => {
      qc.setQueryData<Comment[]>(key(workspaceId, noteId), (old = []) =>
        old
          .filter((c) => c.id !== commentId)
          .map((c) => ({ ...c, replies: c.replies.filter((r) => r.id !== commentId) })),
      );
    },
  });

  const openCount = (query.data ?? []).filter((c) => !c.resolved).length;

  return {
    comments: query.data ?? [],
    openCount,
    isLoading: query.isLoading,
    refetch: invalidate,
    addComment,
    addReply,
    resolve,
    remove,
  };
}
