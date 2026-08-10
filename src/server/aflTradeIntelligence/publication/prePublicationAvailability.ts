import {
  AFL_TRADE_METHODOLOGY_HREF,
  aflTradeValueUnavailableSchema,
  type AflTradeValuationView,
  type AflTradeValueUnavailable,
} from '@/types/aflTradeIntelligence';

export type AflTradeNoPublicationReason = 'no_active_publication' | 'source_blocked';

/** Fail-closed public state when no exact governed valuation publication can be selected. */
export function createAflTradePrePublicationAvailability(
  view: AflTradeValuationView = 'current',
  reason: AflTradeNoPublicationReason = 'no_active_publication'
): AflTradeValueUnavailable {
  const blocked = reason === 'source_blocked';
  return aflTradeValueUnavailableSchema.parse({
    availability: blocked ? 'source_blocked' : 'not_calculated',
    view,
    modelVintage: null,
    temporalContext: null,
    reasonCode: blocked ? 'valuation-source-authority-not-current' : 'no-active-publication',
    message: blocked
      ? 'The active trade-value publication is unavailable because its exact source authority is no longer current.'
      : 'There is no active numerical publication for this trade-value view yet. Approved evidence remains separate from a reviewed calculation and release.',
    nextAction: {
      kind: blocked ? 'view_methodology' : 'await_calculation',
      label: blocked ? 'Read methodology and current limits' : 'Await reviewed calculation',
      href: AFL_TRADE_METHODOLOGY_HREF,
      expectedAfter: null,
    },
    warnings: [],
    methodologyHref: AFL_TRADE_METHODOLOGY_HREF,
  });
}
