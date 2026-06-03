import { NotePage } from '@/components/editor/NotePage';

export default async function NoteRoute({
  params,
}: {
  params: Promise<{ wid: string; nid: string }>;
}) {
  const { wid, nid } = await params;
  return <NotePage workspaceId={wid} noteId={nid} />;
}
