import 'server-only';

import { logger } from '@/lib/logger';

import { AflTradeValueReadError } from '../publication/valueReadService';

/**
 * Trade valuations are published and reviewed separately from the factual archive. A failed
 * valuation read (projection artifact, storage, or selector fault) must not hide the reviewed
 * factual record on the same page, so the page gets `null` and shows valuations as unavailable.
 */
export async function readPublicValuationOrUnavailable<T>(
  page: string,
  read: () => Promise<T>
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    logger.error('AFL trade valuation read failed; showing valuations as unavailable', error, {
      page,
      code: error instanceof AflTradeValueReadError ? error.code : 'UNEXPECTED',
    });
    return null;
  }
}
