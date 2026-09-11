import { describe, expect, it } from 'vitest';
import {
  preparePlayerPavForecastRows,
  preparePlayerPavResearchRows,
  type PlayerPavResearchRow,
} from '@/server/aflTradeIntelligence/modeling/playerPavForecastDesign';
import {
  playerPavForecastConfiguration,
  playerPavForecastFixture,
} from '../testUtils/playerPavForecastFixture';

type Partition = PlayerPavResearchRow['partition'];
const partitions: readonly Partition[] = ['train', 'calibration', 'validation', 'final_test'];
function protectedTargets(open: readonly Partition[]) {
  const set = playerPavForecastFixture();
  return {
    ...set,
    content: {
      ...set.content,
      observations: set.content.observations.map((row) => {
        if (open.includes(row.partition)) return row;
        const protectedRow = { ...row };
        for (const field of ['targetValues', 'outcome', 'outcomeObservedAt']) {
          Object.defineProperty(protectedRow, field, {
            get() {
              throw new Error(`Sealed ${row.partition} ${field}`);
            },
          });
        }
        return protectedRow;
      }),
    },
  };
}

describe('phase-specific PAV numerical target access', () => {
  it.each(partitions)('opens only selected targets inside allowed %s partition', (partition) => {
    const set = playerPavForecastFixture();
    const selected = set.content.observations.find(
      (row) => row.partition === partition
    )!.observationId;
    const protectedSet = {
      ...set,
      content: {
        ...set.content,
        observations: set.content.observations.map((row) => {
          if (row.observationId === selected) return row;
          const protectedRow = { ...row };
          for (const field of ['targetValues', 'outcome', 'outcomeObservedAt'])
            Object.defineProperty(protectedRow, field, {
              get() {
                throw new Error('Unselected target accessed');
              },
            });
          return protectedRow;
        }),
      },
    };
    const rows = preparePlayerPavForecastRows(
      protectedSet,
      playerPavForecastConfiguration,
      [partition],
      [selected]
    );
    expect(rows.filter((row) => row.target !== null).map((row) => row.observationId)).toEqual([
      selected,
    ]);
    expect(rows).toHaveLength(set.content.observations.length);
  });
  it('rejects unknown or duplicate selected target IDs before opening targets', () => {
    const set = protectedTargets([]);
    const known = set.content.observations[0]!.observationId;
    for (const ids of [['unknown'], [known, known]])
      expect(() =>
        preparePlayerPavForecastRows(set, playerPavForecastConfiguration, ['train'], ids)
      ).toThrow(/selected.*(unique|membership)/i);
  });
  it('opens training targets without inspecting calibration or held-out labels', () => {
    const rows = preparePlayerPavForecastRows(
      protectedTargets(['train']),
      playerPavForecastConfiguration,
      ['train']
    );
    expect(rows.some((row) => row.partition === 'train' && row.target !== null)).toBe(true);
    for (const row of rows.filter((row) => row.partition !== 'train')) {
      expect(row).toMatchObject({
        target: null,
        labelAvailableAt: Infinity,
        outcomeUnavailable: 'target_not_opened',
      });
      expect(row.history.length).toBeGreaterThan(0);
    }
  });
  it.each(partitions)('opens only explicitly requested %s targets', (partition) => {
    const rows = preparePlayerPavForecastRows(
      protectedTargets([partition]),
      playerPavForecastConfiguration,
      [partition]
    );
    for (const row of rows) {
      if (row.partition === partition) {
        expect(row.target).not.toBeNull();
        expect(Number.isFinite(row.labelAvailableAt)).toBe(true);
      } else {
        expect(row).toMatchObject({
          target: null,
          labelAvailableAt: Infinity,
          outcomeUnavailable: 'target_not_opened',
        });
      }
    }
  });
  it('supports feature-only prediction with no target partitions opened', () => {
    const rows = preparePlayerPavForecastRows(
      protectedTargets([]),
      playerPavForecastConfiguration,
      []
    );
    expect(rows).toHaveLength(12);
    expect(
      rows.every((row) => row.target === null && row.outcomeUnavailable === 'target_not_opened')
    ).toBe(true);
    expect(rows.every((row) => row.forecastUnavailable === null && row.history.length === 3)).toBe(
      true
    );
  });
  it('retains the research wrapper all-partition behavior', () => {
    const rows = preparePlayerPavResearchRows(
      playerPavForecastFixture(),
      playerPavForecastConfiguration
    );
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.target?.length === 3 && row.outcomeUnavailable === null)).toBe(
      true
    );
    expect(new Set(rows.map((row) => row.partition))).toEqual(new Set(partitions));
  });
  it('preserves point-in-time feature unavailability when every target stays sealed', () => {
    const set = protectedTargets([]);
    const first = set.content.observations[0]!;
    first.featureValues[0]!.calculatedAt = '2026-01-01T00:00:00.000Z';
    const rows = preparePlayerPavForecastRows(set, playerPavForecastConfiguration, []);
    expect(rows[0]).toMatchObject({
      forecastUnavailable: 'feature_not_calculated_by_origin',
      target: null,
      outcomeUnavailable: 'target_not_opened',
    });
  });
  it.each([undefined, null, 'train', ['unknown'], ['train', 'train'], [null]])(
    'rejects invalid requested target partitions %j',
    (invalid) => {
      expect(() =>
        preparePlayerPavForecastRows(
          protectedTargets([]),
          playerPavForecastConfiguration,
          invalid as never
        )
      ).toThrow();
    }
  );
  it('does not silently suppress access to explicitly opened labels', () => {
    expect(() =>
      preparePlayerPavForecastRows(protectedTargets([]), playerPavForecastConfiguration, [
        'calibration',
      ])
    ).toThrow('Sealed calibration targetValues');
  });
});
