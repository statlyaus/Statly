import {
  AFL_TRADE_METHODOLOGY_HREF,
  aflTradeValueUnavailableSchema,
  type AflTradeValueUnavailable,
} from '@/types/aflTradeIntelligence';

/**
 * Fail-closed public state before valuation source use and publication are approved.
 *
 * This is a temporary pre-publication boundary, not a fallback for a failed WP6 read service. Once
 * an approved publication can be selected, the owning read service must return its exact state.
 */
export function createAflTradePrePublicationAvailability(): AflTradeValueUnavailable {
  return aflTradeValueUnavailableSchema.parse({
    availability: 'source_blocked',
    view: 'current',
    modelVintage: null,
    temporalContext: null,
    reasonCode: 'valuation-source-use-not-approved',
    message:
      'Statly cannot calculate this trade-value view because the additional evidence required for valuation has not been approved for that use. The historical archive remains available.',
    nextAction: {
      kind: 'view_methodology',
      label: 'Read methodology and current limits',
      href: AFL_TRADE_METHODOLOGY_HREF,
      expectedAfter: null,
    },
    warnings: [],
    methodologyHref: AFL_TRADE_METHODOLOGY_HREF,
  });
}
