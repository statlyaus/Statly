import type { AflTradePublicationRef, AflTradeValuationView } from '@/types/aflTradeIntelligence';

export const AFL_TRADE_PUBLIC_VALUE_SCOPE = 'public-afl-trades-current' as const;

/**
 * Immutable publication identity captured once for a public read.
 *
 * This contract intentionally has no source-level dependency on the publication command/state
 * machinery. Read adapters can depend on the captured revision shape without coupling their type
 * graph to model construction, gate evaluation, or projection materialization contracts.
 */
export interface AflTradePublicationReadSelection {
  publication: AflTradePublicationRef;
  projectionBuildId: string;
  registryRevision: number;
  scopeKey: string;
  supportedViews: readonly AflTradeValuationView[];
  supportedCohorts: readonly string[];
  excludedCohorts: readonly string[];
}
