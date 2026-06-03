import { WorkspaceView } from '@/components/workspace/WorkspaceView';

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return <WorkspaceView workspaceId={wid} />;
}
