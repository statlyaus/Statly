import {
  categoryForAflTradePickPav,
  createAflTradePickPavObservation,
  createAflTradePickPavObservationSet,
  type AflTradePickPavObservation,
  type AflTradePickPavObservationSet,
  type AflTradePickPavPolicy,
} from './pickOutcomeContracts';

type ReleasedSelection = AflTradePickPavObservation['selection'];
type CalculationMembership = AflTradePickPavObservationSet['content']['calculations'][number];
type PlayerValue = AflTradePickPavObservation['playerValues'][number];

export interface AflTradePickPavCalculationEvidence {
  readonly calculation: CalculationMembership;
  readonly playerValues: readonly PlayerValue[];
}

export interface AflTradePickPavMaterializationRequest {
  readonly environment: 'test_fixture' | 'non_production' | 'production';
  readonly competition: 'AFLM';
  readonly createdAt: string;
  readonly knowledgeCutoffAt: string;
  readonly releaseId: string;
  readonly policy: AflTradePickPavPolicy;
  readonly selections: readonly ReleasedSelection[];
  readonly calculations: readonly AflTradePickPavCalculationEvidence[];
}

function latestInstant(instants: readonly string[]): string {
  return [...instants].sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;
}

function partitionFor(
  policy: AflTradePickPavPolicy,
  draftYear: number
): AflTradePickPavObservation['partition'] {
  const partition = policy.content.partitions.find(
    ({ fromDraftYear, throughDraftYear }) =>
      draftYear >= fromDraftYear && draftYear <= throughDraftYear
  );
  if (!partition) throw new RangeError(`Draft year ${draftYear} is outside the reviewed policy.`);
  return partition.role;
}

function unavailableReason(
  policy: AflTradePickPavPolicy,
  selection: ReleasedSelection
): Extract<AflTradePickPavObservation['outcome'], { state: 'unavailable' }>['reason'] | null {
  if (selection.pathway !== policy.content.supportedPathway) return 'pathway_unsupported';
  if (selection.access.state === 'unresolved') return 'selection_access_unresolved';
  if (selection.access.state === 'restricted') return 'restricted_access';
  return null;
}

function assertRequest(request: AflTradePickPavMaterializationRequest): void {
  if (
    request.environment !== request.policy.content.environment ||
    request.competition !== request.policy.content.competition ||
    Date.parse(request.knowledgeCutoffAt) > Date.parse(request.createdAt)
  ) {
    throw new TypeError('Pick-PAV materialization scope or chronology is invalid.');
  }
  const selectionKeys = request.selections.map(
    ({ selectionId, draftYear, pathway, actualSelectionNumber }) =>
      `${selectionId}|${draftYear}|${pathway}|${actualSelectionNumber}`
  );
  const uniqueSelectionIds = new Set(request.selections.map(({ selectionId }) => selectionId));
  const uniqueSelectionSlots = new Set(
    request.selections.map(
      ({ draftYear, pathway, actualSelectionNumber }) =>
        `${draftYear}|${pathway}|${actualSelectionNumber}`
    )
  );
  if (
    request.selections.length < 4 ||
    uniqueSelectionIds.size !== selectionKeys.length ||
    uniqueSelectionSlots.size !== selectionKeys.length ||
    request.selections.some(({ releaseId }) => releaseId !== request.releaseId)
  ) {
    throw new TypeError('Released draft-selection membership is incomplete, duplicated, or mixed.');
  }
  const calculationIds = request.calculations.map(({ calculation }) => calculation.calculationId);
  const calculationSeasons = request.calculations.map(({ calculation }) => calculation.seasonYear);
  if (
    new Set(calculationIds).size !== calculationIds.length ||
    new Set(calculationSeasons).size !== calculationSeasons.length ||
    request.calculations.some(
      ({ calculation, playerValues }) =>
        calculation.effectiveThrough.slice(0, 4) !== String(calculation.seasonYear) ||
        Date.parse(calculation.calculatedAt) < Date.parse(calculation.effectiveThrough) ||
        playerValues.some(
          (value) =>
            value.calculationId !== calculation.calculationId ||
            value.calculationSha256 !== calculation.calculationSha256 ||
            value.seasonYear !== calculation.seasonYear
        )
    )
  ) {
    throw new TypeError('Finalized PAV calculation evidence is duplicated or internally mixed.');
  }
}

export function materializeAflTradePickPavObservationSet(
  request: AflTradePickPavMaterializationRequest
): AflTradePickPavObservationSet {
  assertRequest(request);
  const calculationsBySeason = new Map(
    request.calculations.map((evidence) => [evidence.calculation.seasonYear, evidence])
  );
  const observations = [...request.selections]
    .sort((left, right) => left.selectionId.localeCompare(right.selectionId))
    .map((selection, index) => {
      const requiredCalculationSeasons = Array.from(
        { length: request.policy.content.fixedHorizonSeasons },
        (_, offset) =>
          selection.draftYear + request.policy.content.firstOutcomeSeasonOffset + offset
      );
      const outcomeHorizonEndsAt = `${requiredCalculationSeasons.at(-1)!}-12-31T23:59:59.000Z`;
      const applicableEvidence: AflTradePickPavCalculationEvidence[] = [];
      for (const seasonYear of requiredCalculationSeasons) {
        const evidence = calculationsBySeason.get(seasonYear);
        if (
          !evidence ||
          Date.parse(evidence.calculation.effectiveThrough) >
            Date.parse(request.knowledgeCutoffAt) ||
          Date.parse(evidence.calculation.calculatedAt) > Date.parse(request.knowledgeCutoffAt)
        ) {
          break;
        }
        applicableEvidence.push(evidence);
      }
      const calculationIds = applicableEvidence.map(({ calculation }) => calculation.calculationId);
      const playerValues = applicableEvidence
        .flatMap(({ playerValues: values }) =>
          values.filter(({ playerId }) => playerId === selection.playerId)
        )
        .sort(
          (left, right) =>
            left.seasonYear - right.seasonYear ||
            left.spellVersionId.localeCompare(right.spellVersionId)
        );
      const contribution = playerValues.reduce((sum, value) => sum + value.totalPav, 0);
      const gamesPlayed = playerValues.reduce((sum, value) => sum + value.gamesPlayed, 0);
      const predictionCutoffAt = `${selection.eventDate}T23:59:59.999Z`;
      const authorityUnavailable = unavailableReason(request.policy, selection);
      const complete = applicableEvidence.length === requiredCalculationSeasons.length;
      const horizonMatured =
        Date.parse(outcomeHorizonEndsAt) <= Date.parse(request.knowledgeCutoffAt);
      const outcomeObservedAt = complete
        ? latestInstant(applicableEvidence.map(({ calculation }) => calculation.calculatedAt))
        : request.knowledgeCutoffAt;
      const outcome: AflTradePickPavObservation['outcome'] =
        authorityUnavailable !== null
          ? { state: 'unavailable', reason: authorityUnavailable }
          : complete
            ? {
                state: 'mature_observed',
                contribution,
                gamesPlayed,
                category: categoryForAflTradePickPav(
                  contribution,
                  gamesPlayed,
                  request.policy.content.categoryMinimums
                ),
              }
            : !horizonMatured && applicableEvidence.length > 0
              ? {
                  state: 'right_censored',
                  contributionObservedToDate: contribution,
                  gamesObservedToDate: gamesPlayed,
                  censoredAt: request.knowledgeCutoffAt,
                }
              : { state: 'unavailable', reason: 'horizon_calculation_missing' };
      return createAflTradePickPavObservation({
        ordinal: index + 1,
        partition: partitionFor(request.policy, selection.draftYear),
        predictionCutoffAt,
        outcomeHorizonEndsAt,
        outcomeObservedAt,
        selection,
        requiredCalculationSeasons,
        calculationIds,
        playerValues,
        outcome,
      });
    });
  const referencedCalculationIds = new Set(
    observations.flatMap(({ calculationIds }) => calculationIds)
  );
  const calculations = request.calculations
    .map(({ calculation }) => calculation)
    .filter(({ calculationId }) => referencedCalculationIds.has(calculationId));
  const draftClassCounts = new Map<string, number>();
  for (const { selection } of observations) {
    const key = `${selection.draftYear}|${selection.pathway}`;
    draftClassCounts.set(key, (draftClassCounts.get(key) ?? 0) + 1);
  }
  const draftClasses = [...draftClassCounts.entries()]
    .map(([key, count]) => {
      const [draftYear, pathway] = key.split('|');
      return {
        draftYear: Number(draftYear),
        pathway: pathway as ReleasedSelection['pathway'],
        expectedSelectionCount: count,
        observationCount: count,
      };
    })
    .sort(
      (left, right) => left.draftYear - right.draftYear || left.pathway.localeCompare(right.pathway)
    );
  return createAflTradePickPavObservationSet({
    schemaVersion: 'afl-trade-pick-pav-observation-set/v1',
    authorityBoundary:
      'private_released_draft_selection_exact_finalized_hpn_pav_no_grade_publication_or_fantasy_ownership',
    publicationEligible: false,
    environment: request.environment,
    competition: request.competition,
    createdAt: request.createdAt,
    knowledgeCutoffAt: request.knowledgeCutoffAt,
    releaseId: request.releaseId,
    policy: request.policy,
    calculations,
    draftClasses,
    observations,
    observationCount: observations.length,
    observationSetSha256: '0'.repeat(64),
  });
}
