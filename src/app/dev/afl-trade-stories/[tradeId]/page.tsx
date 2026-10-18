import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AflTradeStoryPage } from '@/components/aflTradeStory/AflTradeStoryPage';
import { privateTradeStoryReads } from '@/server/aflTradeIntelligence/development/privateTradeStoryReads';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Private trade page | Statly',
  robots: { index: false, follow: false },
};

function parseTradeId(value: string): string | null {
  let tradeId: string;
  try {
    tradeId = decodeURIComponent(value).trim();
  } catch {
    return null;
  }
  if (tradeId.length === 0 || tradeId.length > 200) return null;
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(tradeId) ? tradeId : null;
}

/** One trade's private page. Not found unless the private trade story reader admits the request. */
export default async function PrivateTradeStoryPage({
  params,
}: {
  params: Promise<{ tradeId: string }>;
}) {
  const tradeId = parseTradeId((await params).tradeId);
  if (tradeId === null) notFound();
  const model = await privateTradeStoryReads.loadStory(tradeId);
  if (model === null) notFound();
  return <AflTradeStoryPage model={model} />;
}
