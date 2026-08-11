// @vitest-environment node

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertLocalAflTradeOutcomesRuntimeIdentity,
  installLocalAflTradeOutcomesRuntimeIdentity,
} from '@/server/aflTradeIntelligence/development/localOutcomesRuntimeIdentity';

describe('local AFL outcomes runtime identity', () => {
  let database: PGlite | undefined;

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  it('authenticates only the nonce installed by the current local database process', async () => {
    database = await PGlite.create();
    const firstNonce = 'a'.repeat(64);
    const secondNonce = 'b'.repeat(64);

    await installLocalAflTradeOutcomesRuntimeIdentity(database, firstNonce, 4242);
    await expect(
      assertLocalAflTradeOutcomesRuntimeIdentity(database, firstNonce)
    ).resolves.toBeUndefined();
    await expect(assertLocalAflTradeOutcomesRuntimeIdentity(database, secondNonce)).rejects.toThrow(
      'does not belong to this local stack launch'
    );

    await installLocalAflTradeOutcomesRuntimeIdentity(database, secondNonce, 4343);
    await expect(
      assertLocalAflTradeOutcomesRuntimeIdentity(database, secondNonce)
    ).resolves.toBeUndefined();
  });

  it('rejects an unsafe nonce before issuing database statements', async () => {
    const query = vi.fn();

    await expect(
      installLocalAflTradeOutcomesRuntimeIdentity({ query }, 'not-a-nonce', 4242)
    ).rejects.toThrow('64 lowercase hexadecimal characters');
    expect(query).not.toHaveBeenCalled();
  });
});
