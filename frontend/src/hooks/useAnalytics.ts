'use client';

import { useQuery } from '@tanstack/react-query';
import { analyticsService } from '@/services/analyticsService';

export function useAnalytics(workspaceId: string, periodDays: number) {
  return useQuery({
    queryKey: ['analytics', workspaceId, periodDays],
    queryFn: () => analyticsService.get(workspaceId, periodDays),
    staleTime: 5 * 60 * 1000,   // 5 min — matches server-side cache TTL
    refetchOnWindowFocus: false,
  });
}
