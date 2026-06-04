'use client';

import { useWorkspaceStore } from '@/stores/workspaceStore';
import { AnalyticsDashboard } from './AnalyticsDashboard';

export function AnalyticsWrapper({ workspaceId }: { workspaceId: string }) {
  const workspace = useWorkspaceStore((s) => s.activeWorkspace);
  return (
    <AnalyticsDashboard
      workspaceId={workspaceId}
      workspaceName={workspace?.name ?? 'Workspace'}
    />
  );
}
