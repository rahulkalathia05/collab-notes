import api from '@/lib/api';
import type { SearchResponse } from '@/types';

export interface SearchParams {
  q: string;
  workspace_id?: string;
  page?: number;
  page_size?: number;
}

export const searchService = {
  async search(params: SearchParams): Promise<SearchResponse> {
    const p = new URLSearchParams({ q: params.q });
    if (params.workspace_id) p.set('workspace_id', params.workspace_id);
    if (params.page && params.page > 1) p.set('page', String(params.page));
    if (params.page_size) p.set('page_size', String(params.page_size));
    const res = await api.get<SearchResponse>(`/api/v1/search/?${p}`);
    return res.data;
  },
};
