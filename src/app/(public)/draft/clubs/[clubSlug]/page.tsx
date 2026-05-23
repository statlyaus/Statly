import { notFound } from 'next/navigation';

import { DraftClubTradeHistory } from '@/components/draft/DraftClubTradeHistory';
import { listDraftTradeRefsByClub } from '@/lib/draftTrades/firestore';

export const dynamic = 'force-dynamic';

export default async function DraftClubDetailPage({
  params,
}: {
  params: Promise<{ clubSlug: string }>;
}) {
  const { clubSlug } = await params;
  const normalizedClubSlug = clubSlug.trim().toLowerCase();
  if (!normalizedClubSlug) {
    notFound();
  }

  const refs = await listDraftTradeRefsByClub(normalizedClubSlug);
  if (refs.length === 0) {
    notFound();
  }

  const clubName = refs[0]?.clubName ?? normalizedClubSlug;
  const exportYear = refs[0]?.year ?? null;

  return (
    <DraftClubTradeHistory
      clubSlug={normalizedClubSlug}
      clubName={clubName}
      refs={refs}
      exportYear={exportYear}
    />
  );
}
