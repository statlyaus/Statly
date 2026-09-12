import { describe, expect, it } from 'vitest';
import { createLocalAflTradeFitzRoyFactualRehearsalFixture } from '@/server/aflTradeIntelligence/development/localFitzRoyFactualRehearsalFixture';
import { createAflTradeFitzRoyInvocation } from '@/server/aflTradeIntelligence/source/fitzRoyCaptureContracts';

describe('explicitly synthetic provider rehearsal', () => {
  it('constructs an independent AFL Tables source without changing the default FootyWire authority', () => {
    const original = createLocalAflTradeFitzRoyFactualRehearsalFixture();
    const supplemental = createLocalAflTradeFitzRoyFactualRehearsalFixture({
      provider: 'afl_tables',
    });
    expect(original.command.capture.sourceRights.content.provider).toBe('footywire');
    expect(original.command.fieldMap.mapId).toBe('footywire-player-stats-local-rehearsal-v1');
    expect(supplemental.command.capture.sourceRights.content.provider).toBe('afl_tables');
    expect(supplemental.command.fieldMap.capabilityId).toBe('afl-tables-player-stats');
    expect(supplemental.command.fieldMap.mapId).toBe('afl-tables-player-stats-local-rehearsal-v1');
    expect(supplemental.gateDecisionId).not.toBe(original.gateDecisionId);
  });

  it('preserves default synthetic bytes and gives the supplemental provider its own output', async () => {
    const fixtures = [
      createLocalAflTradeFitzRoyFactualRehearsalFixture(),
      createLocalAflTradeFitzRoyFactualRehearsalFixture({ provider: 'footywire' }),
      createLocalAflTradeFitzRoyFactualRehearsalFixture({ provider: 'afl_tables' }),
    ];
    const outputs = await Promise.all(
      fixtures.map((fixture) =>
        fixture.captureDependencies.executor.execute(
          createAflTradeFitzRoyInvocation(fixture.command.capture.captureRequest),
          { timeoutMs: 30_000, maximumSourceBytes: 1_024, maximumDiagnosticsBytes: 65_536 }
        )
      )
    );
    expect(Array.from(outputs[0]!.sourceBytes)).toEqual([88, 10, 0, 0, 0, 3]);
    expect(outputs[1]).toEqual(outputs[0]);
    expect(Array.from(outputs[2]!.sourceBytes)).toEqual([88, 10, 0, 0, 1, 3]);
    expect(outputs[2]!.diagnostics).toMatchObject({ capabilityId: 'afl-tables-player-stats' });
  });
});
