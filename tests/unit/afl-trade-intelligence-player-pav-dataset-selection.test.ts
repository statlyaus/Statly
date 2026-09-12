import { describe, expect, it } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { selectAflTradePlayerPavDatasetObservations } from '@/server/aflTradeIntelligence/modeling/playerPavDatasetSelection';

const partitions = ['train', 'calibration', 'validation', 'final_test'] as const;
const spellId = (player: string, spell = player) =>
  createAflTradeContentAddress('acquisition-spell-version', { player, spell });

function selectionFixture() {
  const observations = ['a', 'c', 'd', 'e', 'f'].flatMap((playerId) =>
    partitions.map((partition) => ({
      observationId: createAflTradeContentAddress('player-pav-observation', {
        playerId,
        partition,
      }),
      playerId,
      partition,
      acquisitionSpell: {
        spellVersionId: spellId(playerId),
        spellId: playerId,
        clubId: 'club',
        effectiveFrom: '2000-01-01',
        effectiveThrough: null,
        recordedAt: '2026-01-01T00:00:00.000Z',
      },
    }))
  );
  const mapping = (playerId: string, eventId: string, spell = playerId) => ({
    playerId,
    eventId,
    eventVersionId: `version:${eventId}`,
    acquisitionSpellId: spell,
    acquisitionSpellVersionId: spellId(playerId, spell),
    clubId: 'club',
    lineageEdgeIds: [],
  });
  const corpusLineage = {
    content: {
      domainLineageMappings: [
        mapping('a', 'bridge-1'),
        mapping('b', 'bridge-1'),
        mapping('b', 'bridge-2', 'b-next'),
        mapping('c', 'bridge-2'),
        mapping('d', 'd'),
        mapping('e', 'e'),
        mapping('f', 'f'),
        mapping('00-unobserved', 'unobserved-standalone'),
      ],
    },
  };
  const observationSet = {
    observationSetId: createAflTradeContentAddress('player-pav-observation-set', observations),
    content: { observations },
  };
  const inclusionPolicy = {
    schemaVersion: 'afl-trade-player-pav-dataset-inclusion/v1',
    observationSetId: observationSet.observationSetId,
    selectionRule: 'sorted_leakage_components_round_robin',
    partitionOrder: partitions,
    selectionInputs: 'player_event_acquisition_spell_identities_only',
  };
  return { observationSet, corpusLineage, inclusionPolicy };
}

describe('identity-only PAV dataset selection', () => {
  it.each(['playerId', 'clubId', 'spellId', 'spellVersionId'] as const)(
    'still requires the exact sealed %s for every observation',
    (field) => {
      const fixture = selectionFixture();
      const observation = fixture.observationSet.content.observations[0]!;
      if (field === 'playerId') observation.playerId = 'different-player';
      else
        observation.acquisitionSpell[field] =
          field === 'spellVersionId' ? spellId('different-spell') : 'different-identity';
      expect(() => selectAflTradePlayerPavDatasetObservations(fixture)).toThrow(
        'Every original PAV observation requires exact sealed domain lineage.'
      );
    }
  );
  it.each(['independent', 'shared_event'] as const)(
    'conserves forty thousand observations across ten thousand %s lineage identities',
    (shape) => {
      const fixture = selectionFixture();
      const template = fixture.observationSet.content.observations[0]!;
      const mappings = Array.from({ length: 10_000 }, (_, index) => {
        const playerId = `player-${String(index).padStart(5, '0')}`;
        return {
          playerId,
          clubId: 'club',
          eventId: shape === 'shared_event' ? 'shared-event' : `event-${playerId}`,
          eventVersionId: `event-version-${playerId}`,
          acquisitionSpellId: `spell-${playerId}`,
          acquisitionSpellVersionId: spellId(playerId),
          lineageEdgeIds: [],
        };
      });
      const observations = mappings.flatMap((mapping) =>
        partitions.map((partition) => ({
          ...template,
          playerId: mapping.playerId,
          partition,
          observationId: createAflTradeContentAddress('player-pav-observation', {
            playerId: mapping.playerId,
            partition,
          }),
          acquisitionSpell: {
            ...template.acquisitionSpell,
            spellId: mapping.acquisitionSpellId,
            spellVersionId: mapping.acquisitionSpellVersionId,
          },
        }))
      );
      const result = selectAflTradePlayerPavDatasetObservations({
        ...fixture,
        observationSet: { ...fixture.observationSet, content: { observations } },
        corpusLineage: { content: { domainLineageMappings: mappings } },
      });
      expect(result.includedObservationIds).toHaveLength(10_000);
      expect(result.excludedObservations).toHaveLength(30_000);
      const included = new Set(result.includedObservationIds);
      const selected = observations.filter(({ observationId }) => included.has(observationId));
      expect(new Set(selected.map(({ playerId }) => playerId)).size).toBe(10_000);
      expect(selected.slice(0, 4).map(({ playerId, partition }) => [playerId, partition])).toEqual([
        ['player-00000', 'train'],
        ['player-00001', shape === 'shared_event' ? 'train' : 'calibration'],
        ['player-00002', shape === 'shared_event' ? 'train' : 'validation'],
        ['player-00003', shape === 'shared_event' ? 'train' : 'final_test'],
      ]);
      expect(
        [
          ...result.includedObservationIds,
          ...result.excludedObservations.map(({ observationId }) => observationId),
        ].sort()
      ).toEqual(observations.map(({ observationId }) => observationId).sort());
    },
    30_000
  );

  it('closes shared events through an unobserved player with multiple spells without allocating standalone unobserved components', () => {
    const fixture = selectionFixture();
    const result = selectAflTradePlayerPavDatasetObservations(fixture);
    const included = new Set(result.includedObservationIds);
    expect(
      fixture.observationSet.content.observations
        .filter(({ observationId }) => included.has(observationId))
        .map(({ playerId, partition }) => [playerId, partition])
    ).toEqual([
      ['a', 'train'],
      ['c', 'train'],
      ['d', 'calibration'],
      ['e', 'validation'],
      ['f', 'final_test'],
    ]);
  });
});
