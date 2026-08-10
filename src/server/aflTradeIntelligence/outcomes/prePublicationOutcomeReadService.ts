import {
  createAflDraftTradeOutcomeReadService,
  type AflDraftTradeOutcomeRepository,
} from './outcomeReadService';

const unavailableOutcomeRepository: AflDraftTradeOutcomeRepository = {
  async list() {
    throw new Error('No approved AFL Draft & Trade outcome release is active.');
  },
};

/**
 * Honest composition used until an independently approved factual outcome release and exact
 * PostgreSQL-backed projection selector are mounted. It never reads the local workbook, falls back
 * to legacy Firestore, or turns missing evidence into zero-valued outcomes.
 */
export const aflDraftTradePrePublicationOutcomeReadService = createAflDraftTradeOutcomeReadService({
  releaseSelector: {
    async capture() {
      return { registryRevision: 0, selection: null, unavailabilityReason: 'no_active_release' };
    },
  },
  repository: unavailableOutcomeRepository,
});
