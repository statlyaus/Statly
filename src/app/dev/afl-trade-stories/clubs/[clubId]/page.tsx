import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ClubChainsPage } from '@/components/aflTradeStory/ClubChainsPage';
import { privateTradeStoryReads } from '@/server/aflTradeIntelligence/development/privateTradeStoryReads';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Club trade chains | Statly',
  robots: { index: false, follow: false },
};

function parseClubId(value: string): string | null {
  let clubId: string;
  try {
    clubId = decodeURIComponent(value).trim();
  } catch {
    return null;
  }
  if (clubId.length === 0 || clubId.length > 200) return null;
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(clubId) ? clubId : null;
}

/** Every chain of one club (#1051). Not found unless the private trade story reader admits the request. */
export default async function PrivateClubChainsPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const clubId = parseClubId((await params).clubId);
  if (clubId === null) notFound();
  const model = await privateTradeStoryReads.loadClubChains(clubId);
  if (model === null) notFound();
  return <ClubChainsPage model={model} />;
}
