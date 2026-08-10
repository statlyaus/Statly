import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { DraftHubState } from '@/components/draft/DraftHubState';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'AFL Draft Selections & Pick History | Statly',
  description:
    'Explore released AFL draft years, official selection order, selecting and original clubs, resolved players, and pick-trade lineage.',
};

export default async function AflDraftHistoryIndexPage() {
  try {
    const runtime = await getPublicAflTradeReadRuntime();
    const response = await runtime.draftHistoryReadService.listYears();
    const latestYear = response.years[0]?.year;
    if (latestYear) redirect(`/draft/drafts/${latestYear}`);

    return (
      <DraftHubState
        variant="empty"
        title="No reviewed draft years are active"
        description="The draft-history experience is ready. It will list selections only after an exact factual release includes the draft event, its source capture, and any published pick lineage."
        actionHref="/draft/outcomes"
        actionLabel="View factual release status"
      />
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return (
      <DraftHubState
        variant="error"
        title="Draft years could not be loaded"
        description="The reviewed draft-history index is temporarily unavailable. Retry to load the latest released year."
        actionHref="/draft/drafts"
        actionLabel="Retry draft history"
      />
    );
  }
}
