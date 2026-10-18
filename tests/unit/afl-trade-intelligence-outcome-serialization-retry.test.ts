import { describe, expect, it } from 'vitest';

import { retryAflOutcomeSerializationFailure } from '@/server/aflTradeIntelligence/outcomes/serializationRetry';

const serializationFailure = () =>
  Object.assign(new Error('Canonical event changed concurrently; retry the transaction'), {
    code: '40001',
  });

describe('retryAflOutcomeSerializationFailure', () => {
  it('re-runs the whole transaction after a 40001 try-lock loss', async () => {
    let calls = 0;
    const result = await retryAflOutcomeSerializationFailure(
      async () => {
        calls += 1;
        if (calls < 3) throw serializationFailure();
        return 'committed';
      },
      { delayMs: 0 }
    );
    expect(result).toBe('committed');
    expect(calls).toBe(3);
  });

  it('reports the 40001 once the attempts are spent', async () => {
    let calls = 0;
    await expect(
      retryAflOutcomeSerializationFailure(
        async () => {
          calls += 1;
          throw serializationFailure();
        },
        { delayMs: 0 }
      )
    ).rejects.toMatchObject({ code: '40001' });
    expect(calls).toBe(3);
  });

  it('never retries any other failure', async () => {
    let calls = 0;
    await expect(
      retryAflOutcomeSerializationFailure(
        async () => {
          calls += 1;
          throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
        },
        { delayMs: 0 }
      )
    ).rejects.toThrow('deadlock detected');
    expect(calls).toBe(1);
  });
});
