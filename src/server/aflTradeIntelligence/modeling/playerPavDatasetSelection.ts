import { z } from 'zod';

import {
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
} from '../artifacts/contentAddress';
import type { AflTradeCorpusFactualLineage } from '../artifacts/valuationDatasetAdmissionContracts';
import { AFL_TRADE_MODEL_PARTITIONS } from './modelPartitions';
import type { AflTradePlayerPavObservationSet } from './playerPavObservationContracts';

type Partition = (typeof AFL_TRADE_MODEL_PARTITIONS)[number];

/** Candidate selection semantics, not scientific or model qualification authority. */
export const aflTradePlayerPavDatasetInclusionPolicySchema = z
  .object({
    schemaVersion: z.literal('afl-trade-player-pav-dataset-inclusion/v1'),
    observationSetId: aflTradeContentAddressedIdSchema('player-pav-observation-set'),
    selectionRule: z.literal('sorted_leakage_components_round_robin'),
    partitionOrder: z.tuple([
      z.literal('train'),
      z.literal('calibration'),
      z.literal('validation'),
      z.literal('final_test'),
    ]),
    selectionInputs: z.literal('player_event_acquisition_spell_identities_only'),
  })
  .strict();

interface SelectionInput {
  observationSet: {
    observationSetId: AflTradePlayerPavObservationSet['observationSetId'];
    content: {
      observations: readonly Pick<
        AflTradePlayerPavObservationSet['content']['observations'][number],
        'observationId' | 'playerId' | 'partition' | 'acquisitionSpell'
      >[];
    };
  };
  corpusLineage: {
    content: Pick<AflTradeCorpusFactualLineage['content'], 'domainLineageMappings'>;
  };
  inclusionPolicy: unknown;
}

/** Every identity connected through any required leakage group stays in one partition. */
export function selectAflTradePlayerPavDatasetObservations(input: SelectionInput) {
  const policy = aflTradePlayerPavDatasetInclusionPolicySchema.parse(input.inclusionPolicy);
  if (policy.observationSetId !== input.observationSet.observationSetId) {
    throw new TypeError('PAV inclusion policy names a different original observation set.');
  }
  const parents = new Map<string, string>();
  const componentSizes = new Map<string, number>();
  const root = (key: string): string => {
    let current = parents.get(key);
    if (current === undefined) {
      parents.set(key, key);
      componentSizes.set(key, 1);
      return key;
    }
    while (parents.get(current) !== current) current = parents.get(current)!;
    parents.set(key, current);
    return current;
  };
  const join = (left: string, right: string) => {
    const leftRoot = root(left);
    const rightRoot = root(right);
    if (leftRoot === rightRoot) return;
    const leftSize = componentSizes.get(leftRoot)!;
    const rightSize = componentSizes.get(rightRoot)!;
    if (leftSize < rightSize) {
      parents.set(leftRoot, rightRoot);
      componentSizes.set(rightRoot, leftSize + rightSize);
      componentSizes.delete(leftRoot);
    } else {
      parents.set(rightRoot, leftRoot);
      componentSizes.set(leftRoot, leftSize + rightSize);
      componentSizes.delete(rightRoot);
    }
  };
  const observations = input.observationSet.content.observations;
  const observationIds = new Set(observations.map(({ observationId }) => observationId));
  if (observationIds.size !== observations.length)
    throw new TypeError('Original PAV observations are duplicated.');
  const exactLineageIdentities = new Set(
    input.corpusLineage.content.domainLineageMappings.map((mapping) =>
      canonicalizeAflTradeJson([
        mapping.playerId,
        mapping.clubId,
        mapping.acquisitionSpellId,
        mapping.acquisitionSpellVersionId,
      ])
    )
  );
  for (const observation of observations) {
    const identity = canonicalizeAflTradeJson([
      observation.playerId,
      observation.acquisitionSpell.clubId,
      observation.acquisitionSpell.spellId,
      observation.acquisitionSpell.spellVersionId,
    ]);
    if (!exactLineageIdentities.has(identity))
      throw new TypeError('Every original PAV observation requires exact sealed domain lineage.');
  }
  // Sealed lineage can connect observed players through unobserved bridge identities.
  for (const mapping of input.corpusLineage.content.domainLineageMappings) {
    const player = `player:${mapping.playerId}`;
    join(player, `spell:${mapping.acquisitionSpellVersionId}`);
    join(player, `event:${mapping.eventId}`);
  }
  const observedRoots = new Set(observations.map(({ playerId }) => root(`player:${playerId}`)));
  const components = new Map<string, string[]>();
  for (const key of parents.keys()) {
    const representative = root(key);
    const members = components.get(representative) ?? [];
    members.push(key);
    components.set(representative, members);
  }
  const keyFor = (members: readonly string[]) =>
    canonicalizeAflTradeJson(
      ['player:', 'event:', 'spell:'].map((prefix) =>
        members
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length))
          .sort()
      )
    );
  const ordered = [...components.entries()]
    .filter(([representative]) => observedRoots.has(representative))
    .sort((left, right) => {
      const a = keyFor(left[1]);
      const b = keyFor(right[1]);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const assigned = new Map(
    ordered.map(([representative], index) => [
      representative,
      AFL_TRADE_MODEL_PARTITIONS[index % AFL_TRADE_MODEL_PARTITIONS.length]!,
    ])
  );
  const includedObservationIds: string[] = [];
  const excludedObservations: {
    observationId: string;
    assignedPartition: Partition;
    reason: 'assigned_to_different_partition';
  }[] = [];
  for (const observation of observations) {
    const assignedPartition = assigned.get(root(`player:${observation.playerId}`))!;
    if (observation.partition === assignedPartition)
      includedObservationIds.push(observation.observationId);
    else
      excludedObservations.push({
        observationId: observation.observationId,
        assignedPartition,
        reason: 'assigned_to_different_partition',
      });
  }
  includedObservationIds.sort();
  excludedObservations.sort((left, right) =>
    left.observationId < right.observationId ? -1 : left.observationId > right.observationId ? 1 : 0
  );
  return { includedObservationIds, excludedObservations };
}

export function createAflTradePlayerPavDatasetExclusionReport(
  input: SelectionInput & { inclusionPolicyArtifactId: string }
) {
  const inclusionPolicyArtifactId = aflTradeContentAddressedIdSchema('artifact').parse(
    input.inclusionPolicyArtifactId
  );
  return {
    schemaVersion: 'afl-trade-player-pav-dataset-exclusion/v1' as const,
    observationSetId: input.observationSet.observationSetId,
    inclusionPolicyArtifactId,
    ...selectAflTradePlayerPavDatasetObservations(input),
  };
}
