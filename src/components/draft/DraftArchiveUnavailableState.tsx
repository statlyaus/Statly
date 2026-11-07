import type { DraftTradeReleaseAvailability } from '@/lib/draftTrades/read';

import { DraftHubState } from './DraftHubState';

const copy = {
  active: {
    title: 'No trade records in the active release',
    description: 'The reviewed release that is active right now contains no trade records.',
  },
  no_active_release: {
    title: 'No reviewed trade release is active',
    description: 'Trade records appear here once a reviewed factual release is published.',
  },
  source_blocked: {
    title: 'Trade records are temporarily withdrawn',
    description:
      'The reviewed release is withdrawn while permission to use one of its sources is confirmed. Records return once it is.',
  },
  gate2_blocked: {
    title: 'Trade records are temporarily withheld',
    description:
      'The reviewed release is withheld until its factual review is current again. Records return once it is.',
  },
} as const satisfies Record<DraftTradeReleaseAvailability, { title: string; description: string }>;

// The honest empty state for the public trade and club archive: it says whether no release is
// active or an active release is withdrawn, never that records are "not imported yet".
export function DraftArchiveUnavailableState({
  availability,
}: {
  availability: DraftTradeReleaseAvailability;
}) {
  return (
    <DraftHubState
      variant="empty"
      title={copy[availability].title}
      description={copy[availability].description}
      actionHref="/draft/outcomes"
      actionLabel="View factual release status"
    />
  );
}
