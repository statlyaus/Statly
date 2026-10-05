import { z } from 'zod';

import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeGovernedPickPavModelCandidateSchema,
  type AflTradeGovernedPickPavModelCandidate,
} from './governedPickPavModelCandidate';
import {
  aflTradePickPavModelRunAuthorizationSchema,
  type AflTradePickPavModelRunAuthorization,
} from './pickPavModelCandidateAuthority';

const isoInstantSchema = z.iso.datetime({ offset: true });

const consumptionContentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-pick-pav-model-run-consumption/v1'),
    authorityBoundary: z.literal(
      'exactly_once_non_production_candidate_consumption_not_gate_3_trade_scoring_or_publication_authority'
    ),
    environment: z.literal('non_production'),
    publicationEligible: z.literal(false),
    runAuthorizationId: aflTradeContentAddressedIdSchema(
      'pick-pav-model-run-authorization'
    ),
    candidateId: aflTradeContentAddressedIdSchema('pick-pav-model-candidate'),
    consumedAt: isoInstantSchema,
    consumptionState: z.literal('consumed'),
    gate3Authority: z.literal('not_granted'),
    tradeScoringAuthority: z.literal('not_granted'),
  })
  .strict();

export const aflTradePickPavModelRunConsumptionSchema = z
  .object({
    consumptionId: aflTradeContentAddressedIdSchema('pick-pav-model-run-consumption'),
    content: consumptionContentSchema,
  })
  .strict()
  .superRefine((consumption, context) => {
    addAflTradeContentAddressIssue(
      'pick-pav-model-run-consumption',
      consumption.consumptionId,
      consumption.content,
      context,
      ['consumptionId']
    );
  });

export type AflTradePickPavModelRunConsumption = z.infer<
  typeof aflTradePickPavModelRunConsumptionSchema
>;

export function createAflTradePickPavModelRunConsumption(input: {
  authorization: AflTradePickPavModelRunAuthorization;
  candidate: AflTradeGovernedPickPavModelCandidate;
  consumedAt: string;
}): AflTradePickPavModelRunConsumption {
  const authorization = aflTradePickPavModelRunAuthorizationSchema.parse(
    input.authorization
  );
  const candidate = aflTradeGovernedPickPavModelCandidateSchema.parse(input.candidate);
  if (
    candidate.content.runAuthorizationId !== authorization.runAuthorizationId ||
    candidate.content.runIntentId !== authorization.content.runIntentId ||
    candidate.content.observationAdmissionId !==
      authorization.content.observationAdmissionId ||
    candidate.content.observationSetId !== authorization.content.observationSetId
  ) {
    throw new TypeError(
      'Pick model run consumption requires exact candidate and authorization ancestry.'
    );
  }

  const consumedAt = Date.parse(input.consumedAt);
  if (
    consumedAt < Date.parse(candidate.content.completedAt) ||
    consumedAt < Date.parse(authorization.content.authorizedAt) ||
    consumedAt > Date.parse(authorization.content.validThrough)
  ) {
    throw new TypeError(
      'Pick model run consumption must occur after candidate completion and within the authorization window.'
    );
  }

  const content = consumptionContentSchema.parse({
    schemaVersion: 'afl-trade-pick-pav-model-run-consumption/v1',
    authorityBoundary:
      'exactly_once_non_production_candidate_consumption_not_gate_3_trade_scoring_or_publication_authority',
    environment: 'non_production',
    publicationEligible: false,
    runAuthorizationId: authorization.runAuthorizationId,
    candidateId: candidate.candidateId,
    consumedAt: input.consumedAt,
    consumptionState: 'consumed',
    gate3Authority: 'not_granted',
    tradeScoringAuthority: 'not_granted',
  });
  return aflTradePickPavModelRunConsumptionSchema.parse({
    consumptionId: createAflTradeContentAddress('pick-pav-model-run-consumption', content),
    content,
  });
}
