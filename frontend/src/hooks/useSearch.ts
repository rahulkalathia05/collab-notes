'use client';

import { useQuery } from '@tanstack/react-query';
import { searchService } from '@/services/searchService';

interface UseSearchOptions {
  query: string;
  page?: number;
  workspaceId?: string;
  pageSize?: number;
}

export function useSearch({ query, page = 1, workspaceId, pageSize = 20 }: UseSearchOptions) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: ['search', trimmed, page, workspaceId, pageSize],
    queryFn: () =>
      searchService.search({
        q: trimmed,
        page,
        workspace_id: workspaceId,
        page_size: pageSize,
      }),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev, // keep previous page while fetching next
  });
}
