import api from '@/lib/api';
import type { Comment } from '@/types';

export interface CommentCreatePayload {
  content: string;
  comment_type: 'note' | 'selection';
  selection_from?: number;
  selection_to?: number;
  anchor_text?: string;
}

function base(workspaceId: string, noteId: string) {
  return `/api/v1/workspaces/${workspaceId}/notes/${noteId}/comments`;
}

export const commentService = {
  list(workspaceId: string, noteId: string, includeResolved = true): Promise<Comment[]> {
    return api
      .get<Comment[]>(base(workspaceId, noteId), {
        params: { include_resolved: includeResolved },
      })
      .then((r) => r.data);
  },

  create(workspaceId: string, noteId: string, payload: CommentCreatePayload): Promise<Comment> {
    return api.post<Comment>(base(workspaceId, noteId), payload).then((r) => r.data);
  },

  createReply(workspaceId: string, noteId: string, commentId: string, content: string): Promise<Comment> {
    return api
      .post<Comment>(`${base(workspaceId, noteId)}/${commentId}/replies`, { content })
      .then((r) => r.data);
  },

  resolve(workspaceId: string, noteId: string, commentId: string): Promise<Comment> {
    return api
      .patch<Comment>(`${base(workspaceId, noteId)}/${commentId}/resolve`)
      .then((r) => r.data);
  },

  delete(workspaceId: string, noteId: string, commentId: string): Promise<void> {
    return api.delete(`${base(workspaceId, noteId)}/${commentId}`).then(() => undefined);
  },
};
