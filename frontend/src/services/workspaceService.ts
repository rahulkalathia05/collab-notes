import api from '@/lib/api';
import type { PaginatedResponse, Workspace, WorkspaceFilters, WorkspaceMember } from '@/types';

export const workspaceService = {
  list: async (filters: WorkspaceFilters = {}): Promise<PaginatedResponse<Workspace>> => {
    const params = new URLSearchParams();
    if (filters.search?.trim()) params.set('search', filters.search.trim());
    if (filters.role) params.set('role', filters.role);
    if (filters.page && filters.page > 1) params.set('page', String(filters.page));
    if (filters.page_size) params.set('page_size', String(filters.page_size));
    const qs = params.toString();
    const res = await api.get<PaginatedResponse<Workspace>>(
      `/api/v1/workspaces${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  get: async (id: string): Promise<Workspace> => {
    const res = await api.get<Workspace>(`/api/v1/workspaces/${id}`);
    return res.data;
  },

  create: async (data: { name: string; icon?: string }): Promise<Workspace> => {
    const res = await api.post<Workspace>('/api/v1/workspaces', data);
    return res.data;
  },

  update: async (id: string, data: { name?: string; icon?: string }): Promise<Workspace> => {
    const res = await api.patch<Workspace>(`/api/v1/workspaces/${id}`, data);
    return res.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/v1/workspaces/${id}`);
  },

  listMembers: async (id: string): Promise<WorkspaceMember[]> => {
    const res = await api.get<WorkspaceMember[]>(`/api/v1/workspaces/${id}/members`);
    return res.data;
  },

  inviteMember: async (
    id: string,
    data: { email: string; role: WorkspaceMember['role'] }
  ): Promise<WorkspaceMember> => {
    const res = await api.post<WorkspaceMember>(`/api/v1/workspaces/${id}/members`, data);
    return res.data;
  },
};
