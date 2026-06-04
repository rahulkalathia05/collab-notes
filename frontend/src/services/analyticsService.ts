import api from '@/lib/api';

export interface DateCount { date: string; count: number; }
export interface AIUsagePoint { date: string; count: number; by_action: Record<string, number>; }
export interface OverviewMetrics {
  total_notes: number; total_users: number; total_edits: number;
  total_ai_calls: number; total_comments: number;
  notes_delta: number; edits_delta: number; ai_delta: number; comments_delta: number;
}
export interface TopNote { note_id: string; title: string; edits: number; comments: number; last_activity: string; }
export interface MemberActivity {
  user_id: string; name: string; email: string; avatar_url?: string;
  notes_created: number; edits: number; comments: number; total: number;
}
export interface AnalyticsData {
  workspace_id: string;
  period_days: number;
  generated_at: string;
  overview: OverviewMetrics;
  notes_over_time: DateCount[];
  edits_over_time: DateCount[];
  active_users_over_time: DateCount[];
  ai_usage_over_time: AIUsagePoint[];
  collaboration_over_time: DateCount[];
  top_notes: TopNote[];
  member_activity: MemberActivity[];
}

export const analyticsService = {
  get: async (workspaceId: string, periodDays: number): Promise<AnalyticsData> => {
    const res = await api.get<AnalyticsData>(
      `/api/v1/analytics/?workspace_id=${workspaceId}&period_days=${periodDays}`,
    );
    return res.data;
  },
};
