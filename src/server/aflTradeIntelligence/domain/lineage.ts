/**
 * Stable public entry point for AFL trade lineage foundations.
 *
 * Internal modules deliberately flow from types to temporal helpers, then to validation and
 * attribution. Consumers should continue importing this barrel unless they are internal fixtures
 * avoiding a dependency cycle.
 */
export * from './lineageTypes';
export {
  buildAflTradeAttributionFrontier,
  findAflTradeAssetCustodian,
  validateAflTradeAttribution,
} from './lineageAttribution';
export { validateAflTradeLineageGraph } from './lineageValidation';
