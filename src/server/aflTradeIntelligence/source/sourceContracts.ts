/**
 * Stable source-governance entry point.
 *
 * Gate 0A permission is deliberately separate from Gate 0B data sufficiency. No combined "Gate 0"
 * evaluator or universal numerical threshold is exported from this boundary.
 */
export * from './sourceRights';
export * from './gate0aEvaluation';
export * from './gate0aReceipt';
