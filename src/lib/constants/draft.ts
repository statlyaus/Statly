/**
 * Draft-related constants
 */

// Pre-start delay: 5 minutes before draft starts
export const PRE_START_DELAY_MS = 5 * 60 * 1000;

// Job retry configuration
export const DRAFT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000,
  },
  removeOnComplete: true,
  removeOnFail: true,
} as const;
