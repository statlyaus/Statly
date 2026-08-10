import {
  createAflTradeValueReadService,
  type AflTradeValueProjectionRepository,
} from './valueReadService';

export { AFL_TRADE_PUBLIC_VALUE_SCOPE } from './publicationReadContracts';

const unavailableProjectionRepository: AflTradeValueProjectionRepository = {
  async list() {
    throw new Error('No AFL trade-value projection is active.');
  },
  async detail() {
    throw new Error('No AFL trade-value projection is active.');
  },
};

/**
 * Verified prepublication composition. This is replaced only when durable registry and projection
 * adapters have passed the required gates; it never impersonates an empty production registry.
 */
export const aflTradePrePublicationValueReadService = createAflTradeValueReadService({
  publicationSelector: {
    async capture() {
      return {
        registryRevision: 0,
        selection: null,
        unavailabilityReason: 'no_active_publication',
      };
    },
  },
  projectionRepository: unavailableProjectionRepository,
});
