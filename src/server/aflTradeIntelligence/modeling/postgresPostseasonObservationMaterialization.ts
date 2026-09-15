import { z } from 'zod';
import { aflTradeContentAddressedIdSchema } from '../artifacts/contentAddress';
import { aflTradePostseasonSeasonWindow } from '../domain/postseasonYearContext';
import { deriveAflTradeAcquisitionMembershipBounds } from '../outcomes/acquisitionSpellRegistrationContracts';
import type { AflTradeAcquisitionRegistrationEvidenceReader } from '../outcomes/postgresAcquisitionSpellRegistrationRepository';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import type { AflTradeHpnPavMethodAuthority } from './hpnPavCalculationService';
import { createAflTradePlayerPavCalculationEvidence } from './playerPavCalculationEvidence';
import { loadCurrentAflTradePlayerPavPolicy } from './postgresPlayerPavObservationRepository';
import { loadCurrentAflTradePostseasonContext } from './postgresPostseasonContextAuthority';
import { loadCurrentAflTradePostseasonCoverage } from './postgresPostseasonCoverageAuthority';
import {
  createAflTradePostseasonPlayerPavObservation,
  aflTradePostseasonPlayerPavObservationContentSchema,
} from './postseasonPlayerPavObservation';

export const aflTradePostseasonObservationMaterializationRequestSchema = z
  .object({
    environment: z.enum(['test_fixture', 'non_production']),
    reviewDecisionId: z.string().min(1).max(240),
    policyId: aflTradeContentAddressedIdSchema('player-pav-policy'),
    knowledgeCutoffAt: z.iso.datetime({ offset: true }),
  })
  .strict();

type Season = z.infer<
  typeof aflTradePostseasonPlayerPavObservationContentSchema
>['features'][number];
type Coverage = NonNullable<Awaited<ReturnType<typeof loadCurrentAflTradePostseasonCoverage>>>;
type Selection = Awaited<ReturnType<typeof loadCurrentAflTradePostseasonContext>>;

function annualValue(
  selection: Selection,
  year: number,
  feature: boolean,
  coverage: Coverage | null
): Season {
  const bounds = deriveAflTradeAcquisitionMembershipBounds(selection.acquisitionSpell);
  const spell = selection.acquisitionSpell.content;
  if (
    !feature &&
    (`${year}-01-01` < bounds.certain.startDate || `${year}-01-01` > bounds.certain.endDate)
  )
    return { seasonYear: year, state: 'unavailable', reason: 'membership_incomplete' };
  if (year < 1998)
    return { seasonYear: year, state: 'unavailable', reason: 'historical_contract_unsupported' };
  if (!coverage || (feature && coverage.coverage.content.state !== 'complete'))
    return { seasonYear: year, state: 'unavailable', reason: 'season_incomplete' };
  const evidence = createAflTradePlayerPavCalculationEvidence({
    calculation: coverage.calculation,
    environment: spell.environment,
    competition: 'AFLM',
    methodId: coverage.calculation.content.methodId,
    seasonYears: [year],
    knowledgeCutoffAt: selection.context.content.knowledgeCutoffAt,
  });
  const values = evidence.playerValues.filter(
    (value) =>
      value.playerId === spell.playerId &&
      (feature ||
        (value.spellVersionId === selection.acquisitionSpell.spellVersionId &&
          value.clubId === spell.clubId))
  );
  if (values.length === 0)
    return { seasonYear: year, state: 'unavailable', reason: 'source_missing' };
  const complete =
    coverage.coverage.content.state === 'complete' &&
    (feature || `${year}-12-31` <= bounds.certain.endDate);
  return {
    seasonYear: year,
    state: complete ? 'observed' : 'partial',
    values,
    coverageEvidence: coverage.coverage.content.evidence,
  };
}

/** Derives the v3 builder input from durable owners only; its caller owns persistence in this transaction. */
export async function materializeAflTradePostseasonObservation(
  transaction: AflOutcomeSqlTransaction,
  input: unknown,
  methodAuthority: AflTradeHpnPavMethodAuthority,
  evidence: AflTradeAcquisitionRegistrationEvidenceReader
) {
  const request = aflTradePostseasonObservationMaterializationRequestSchema.parse(input);
  const selection = await loadCurrentAflTradePostseasonContext(
    transaction,
    {
      environment: request.environment,
      reviewDecisionId: request.reviewDecisionId,
      knowledgeCutoffAt: request.knowledgeCutoffAt,
    },
    evidence
  );
  const policy = await loadCurrentAflTradePlayerPavPolicy(
    transaction,
    request.policyId,
    request.environment
  );
  if (
    policy.content.schemaVersion !== 'afl-trade-player-pav-policy/v2' ||
    policy.content.fixedHorizonSeasons !== 3 ||
    policy.content.competition !== 'AFLM' ||
    Date.parse(policy.content.createdAt) > Date.parse(request.knowledgeCutoffAt) ||
    !policy.content.partitions.some(
      (part) =>
        selection.context.content.tradeYear >= part.fromPredictionSeason &&
        selection.context.content.tradeYear <= part.throughPredictionSeason
    )
  ) {
    throw new Error('Postseason observation requires an in-scope retrospective policy.');
  }
  const approval = await transaction.query<{ approval_decision_id: string }>(
    `SELECT policy.approval_decision_id FROM outcome_player_pav_policy policy
     JOIN outcome_review_decision decision ON decision.decision_id=policy.approval_decision_id
     WHERE policy.policy_id=$1 AND decision.decided_at<=$2::timestamptz FOR SHARE OF policy,decision`,
    [policy.policyId, request.knowledgeCutoffAt]
  );
  if (approval.rows.length !== 1)
    throw new Error('Postseason policy approval exceeds the knowledge cutoff.');
  const history = z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .parse(policy.content.featureHistorySeasons);
  const window = aflTradePostseasonSeasonWindow(selection.context, history);
  const coverage = new Map<number, Coverage | null>();
  for (const year of [...window.featureSeasons, ...window.outcomeSeasons]) {
    coverage.set(
      year,
      year < 1998
        ? null
        : await loadCurrentAflTradePostseasonCoverage(
            transaction,
            {
              environment: request.environment,
              competition: 'AFLM',
              methodId: policy.content.methodId,
              seasonYear: year,
              knowledgeCutoffAt: request.knowledgeCutoffAt,
            },
            methodAuthority,
            evidence
          )
    );
  }
  const observation = createAflTradePostseasonPlayerPavObservation({
    context: selection.context,
    releaseId: selection.release.releaseId,
    acquisitionSpell: selection.acquisitionSpell,
    historySeasons: history,
    features: window.featureSeasons.map((year) =>
      annualValue(selection, year, true, coverage.get(year) ?? null)
    ),
    outcomes: window.outcomeSeasons.map((year) =>
      annualValue(selection, year, false, coverage.get(year) ?? null)
    ),
  });
  const coverageBindings = [...coverage].map(([seasonYear, current]) => ({
    seasonYear,
    coverageId: current?.coverage.coverageId ?? null,
    reviewDecisionId: current?.reviewDecisionId ?? null,
    calculationId: current?.calculation.calculationId ?? null,
  }));
  return {
    observation,
    policy,
    policyApprovalDecisionId: approval.rows[0]!.approval_decision_id,
    coverageBindings,
    selection,
  };
}
