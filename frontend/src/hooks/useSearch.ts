'use client';

import { useQuery } from '@tanstack/react-query';
import { searchService } from '@/services/searchService';
import type { SearchMode } from '@/types';

interface UseSearchOptions {
  query: string;
  mode?: SearchMode;
  page?: number;
  workspaceId?: string;
  pageSize?: number;
}

export function useSearch({ query, mode = 'keyword', page = 1, workspaceId, pageSize = 20 }: UseSearchOptions) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: ['search', trimmed, mode, page, workspaceId, pageSize],
    queryFn: () =>
      searchService.search({
        q: trimmed,
        mode,
        page,
        workspace_id: workspaceId,
        page_size: pageSize,
      }),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}
