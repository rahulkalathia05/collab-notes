import { Suspense } from 'react';
import { AnalyticsWrapper } from '@/components/analytics/AnalyticsWrapper';

export const metadata = { title: 'Analytics — CollabNotes' };

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  return (
    <Suspense>
      <AnalyticsWrapper workspaceId={wid} />
    </Suspense>
  );
}
