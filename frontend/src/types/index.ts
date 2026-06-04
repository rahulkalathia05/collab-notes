export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  icon?: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export interface WorkspaceFilters {
  search?: string;
  role?: Workspace['role'] | '';
  page?: number;
  page_size?: number;
}

export interface WorkspaceMember {
  workspace_id: string;
  user: User;
  role: Workspace['role'];
  joined_at: string;
}

export interface Note {
  id: string;
  workspace_id: string;
  title: string;
  content?: Record<string, unknown>;
  content_text?: string;
  created_by: string;
  updated_by?: string;
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  collaborators?: User[];
}

export interface NoteVersion {
  id: string;
  note_id: string;
  content: Record<string, unknown>;
  label?: string;
  snapshot_by: string;
  created_at: string;
}

export interface Comment {
  id: string;
  note_id: string;
  parent_id?: string;
  user: User;
  content: string;
  comment_type: 'note' | 'selection';
  selection_from?: number;
  selection_to?: number;
  anchor_text?: string;
  resolved: boolean;
  resolved_by?: string;
  created_at: string;
  updated_at: string;
  replies: Comment[];
}

export interface NoteShare {
  id: string;
  note_id: string;
  shared_with?: User;
  token?: string;
  permission: 'view' | 'comment' | 'edit';
  expires_at?: string;
  created_at: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface ApiError {
  detail: string;
}

export interface SearchResult {
  note: Note;
  rank?: number;
  headline?: string;
}

export type UserStatus = 'viewing' | 'editing';

export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  clientId: number;
  status: UserStatus;
}

/** Awareness state carried inside every `awareness` WebSocket message. */
export interface AwarenessState {
  user?: {
    id: string;
    name: string;
    color: string;
  };
  status?: UserStatus;
  /**
   * Yjs relative position set by CollaborationCursor — treated as an opaque
   * blob by our code and decoded by TipTap's extension on the receiver side.
   */
  cursor?: Record<string, unknown> | null;
}
