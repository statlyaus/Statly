import { redirect } from 'next/navigation';

export default async function LeagueSocialPostPage({
  params,
}: {
  params: Promise<{ id: string; postId: string }>;
}) {
  const { id, postId } = await params;
  redirect(
    `/leagues/${encodeURIComponent(id)}/social?view=board&post=${encodeURIComponent(postId)}`
  );
}
