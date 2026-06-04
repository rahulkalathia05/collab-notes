import api from '@/lib/api';
import type { SearchMode, SearchResponse } from '@/types';

export interface SearchParams {
  q: string;
  mode?: SearchMode;
  workspace_id?: string;
  page?: number;
  page_size?: number;
}

export const searchService = {
  async search(params: SearchParams): Promise<SearchResponse> {
    const p = new URLSearchParams({ q: params.q });
    if (params.mode && params.mode !== 'keyword') p.set('mode', params.mode);
    if (params.workspace_id) p.set('workspace_id', params.workspace_id);
    if (params.page && params.page > 1) p.set('page', String(params.page));
    if (params.page_size) p.set('page_size', String(params.page_size));
    const res = await api.get<SearchResponse>(`/api/v1/search/?${p}`);
    return res.data;
  },

  async reindex(workspaceId?: string): Promise<{ ok: number; skipped: number; failed: number; message: string }> {
    const p = workspaceId ? `?workspace_id=${workspaceId}` : '';
    const res = await api.post(`/api/v1/search/reindex${p}`);
    return res.data;
  },
};
