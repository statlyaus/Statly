/** Shared chronology; partition identities are stable across scalar and PAV contracts. */
export const AFL_TRADE_MODEL_PARTITIONS = [
  'train',
  'calibration',
  'validation',
  'final_test',
] as const;
