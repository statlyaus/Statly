import { z } from 'zod';
import {
  aflTradeArtifactRefSchema,
  doesAflTradeArtifactRefMatchBytes,
} from '../artifacts/artifactReference';
import {
  addAflTradeContentAddressIssue,
  aflTradeContentAddressedIdSchema,
  canonicalizeAflTradeJson,
  createAflTradeContentAddress,
} from '../artifacts/contentAddress';
import {
  aflTradeModelRunIntentSchema,
  type AflTradeModelRunIntent,
} from '../artifacts/modelRunManifest';
import {
  aflTradePlayerPavModelProtocolSchema,
  type AflTradePlayerPavModelProtocol,
} from '../artifacts/modelProtocol';
import { type AflTradeValuationDatasetCandidate } from '../artifacts/valuationDatasetAdmissionContracts';
import {
  createAflTradePlayerObservationSetV3,
  type AflTradePlayerObservationSetV3,
} from './playerContributionContracts';
import {
  aflTradePlayerPavObservationSetSchema,
  type AflTradePlayerPavObservationSet,
} from './playerPavObservationContracts';
import { aflTradeHpnPavMethodSchema, type AflTradeHpnPavMethod } from './hpnPlayerApproximateValue';
import {
  fitPlayerPavForecast,
  restorePlayerPavForecast,
  playerPavForecastFitStateSchema,
} from './playerPavForecastFit';
import { preparePlayerPavForecastRows } from './playerPavForecastDesign';

const candidateChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('persistence'), historySeasons: z.literal(1) }).strict(),
  z
    .object({
      kind: z.literal('shrinkage'),
      historySeasons: z.number().int().min(1).max(3),
      pseudoSeasons: z.number().finite().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ridge'),
      historySeasons: z.number().int().min(1).max(3),
      penalty: z.number().finite().positive(),
    })
    .strict(),
]);
export const aflTradeAdmittedPlayerPavFitConfigurationSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-admitted-player-pav-fit-config/v1'),
    candidate: candidateChoice,
  })
  .strict();
const contentSchema = z
  .object({
    schemaVersion: z.literal('afl-trade-admitted-player-pav-candidate/v1'),
    authorityBoundary: z.literal('numerical_fit_only_no_execution_or_qualification_authority'),
    publicationEligible: z.literal(false),
    intentId: aflTradeContentAddressedIdSchema('model-run-intent'),
    protocolId: aflTradeContentAddressedIdSchema('model-protocol'),
    datasetId: aflTradeContentAddressedIdSchema('dataset'),
    datasetAdmissionId: aflTradeContentAddressedIdSchema('dataset-admission'),
    observationSetId: aflTradeContentAddressedIdSchema('player-observation-set'),
    pavObservationSetId: aflTradeContentAddressedIdSchema('player-pav-observation-set'),
    pavPolicyId: aflTradeContentAddressedIdSchema('player-pav-policy'),
    methodId: aflTradeContentAddressedIdSchema('hpn-pav-method'),
    configurationArtifact: aflTradeArtifactRefSchema,
    trainingObservationIds: z
      .array(aflTradeContentAddressedIdSchema('player-pav-observation'))
      .min(1)
      .max(100_000),
    fitState: playerPavForecastFitStateSchema,
  })
  .strict();
export const aflTradeAdmittedPlayerPavCandidateSchema = z
  .object({
    candidateId: aflTradeContentAddressedIdSchema('admitted-player-pav-candidate'),
    content: contentSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    addAflTradeContentAddressIssue(
      'admitted-player-pav-candidate',
      candidate.candidateId,
      candidate.content,
      context,
      ['candidateId']
    );
  });
export type AflTradeAdmittedPlayerPavCandidate = z.infer<
  typeof aflTradeAdmittedPlayerPavCandidateSchema
>;
export interface AflTradeAdmittedPlayerPavFitInput {
  intent: AflTradeModelRunIntent;
  protocol: AflTradePlayerPavModelProtocol;
  datasetCandidate: AflTradeValuationDatasetCandidate;
  observationSet: AflTradePlayerObservationSetV3;
  pavObservationSet: AflTradePlayerPavObservationSet;
  hpnMethod: AflTradeHpnPavMethod;
  configurationBytes: Uint8Array;
}

function authenticate(input: AflTradeAdmittedPlayerPavFitInput) {
  const intent = aflTradeModelRunIntentSchema.parse(input.intent);
  const protocol = aflTradePlayerPavModelProtocolSchema.parse(input.protocol);
  const original = aflTradePlayerPavObservationSetSchema.parse(input.pavObservationSet);
  const method = aflTradeHpnPavMethodSchema.parse(input.hpnMethod);
  const exactDocument = (reference: z.infer<typeof aflTradeArtifactRefSchema>, document: unknown) =>
    doesAflTradeArtifactRefMatchBytes(
      reference,
      new TextEncoder().encode(canonicalizeAflTradeJson(document)),
      'application/json'
    );
  if (
    intent.content.modelProtocolId !== protocol.protocolId ||
    intent.content.datasetId !== input.datasetCandidate.datasetId ||
    protocol.content.datasetId !== input.datasetCandidate.datasetId ||
    intent.content.datasetAdmissionId !== protocol.content.datasetAdmission.admissionId ||
    intent.content.environment !== protocol.content.environment ||
    original.content.environment !== protocol.content.environment ||
    canonicalizeAflTradeJson(intent.content.windows) !==
      canonicalizeAflTradeJson(protocol.content.windows) ||
    protocol.content.sourceObservationSet.observationSetId !== original.observationSetId ||
    !exactDocument(protocol.content.sourceObservationSet.artifact, original) ||
    protocol.content.pavPolicy.policyId !== original.content.policy.policyId ||
    !exactDocument(protocol.content.pavPolicy.artifact, original.content.policy) ||
    protocol.content.hpnMethod.methodId !== method.methodId ||
    original.content.policy.content.methodId !== method.methodId ||
    !exactDocument(protocol.content.hpnMethod.artifact, method)
  )
    throw new RangeError('Native PAV fit requires the exact intent and original parents.');
  const projection = createAflTradePlayerObservationSetV3({
    candidate: input.datasetCandidate,
    datasetAdmissionId: intent.content.datasetAdmissionId,
    modelProtocolId: protocol.protocolId,
    pavObservationSet: original,
  });
  if (
    projection.observationSetId !== intent.content.observationSetId ||
    canonicalizeAflTradeJson(projection) !== canonicalizeAflTradeJson(input.observationSet) ||
    projection.content.featureKnowledgePolicy !== protocol.content.featurePolicy.knowledgeJoin
  )
    throw new RangeError('Native PAV fit requires the exact admitted selected observations.');
  if (
    !doesAflTradeArtifactRefMatchBytes(
      intent.content.configurationArtifact,
      input.configurationBytes,
      'application/json'
    )
  )
    throw new RangeError('Native PAV fit configuration bytes differ from the exact intent.');
  const configuration = aflTradeAdmittedPlayerPavFitConfigurationSchema.parse(
    JSON.parse(new TextDecoder().decode(input.configurationBytes))
  );
  const rows = preparePlayerPavForecastRows(
    original,
    {
      featureHistories: [configuration.candidate.historySeasons],
      knowledgePolicy: original.content.knowledgePolicy
        ? 'retrospective_finalized_measurements'
        : 'calculated_by_origin',
    },
    ['train'],
    projection.content.observations.map(({ pavObservation }) => pavObservation.observationId)
  );
  const byId = new Map(rows.map((row) => [row.observationId, row]));
  const selected = projection.content.observations.map(({ pavObservation }) =>
    byId.get(pavObservation.observationId)!
  );
  const windows = {
    train: protocol.content.windows.train,
    calibration: protocol.content.windows.calibration,
    validation: protocol.content.windows.validation,
    final_test: protocol.content.windows.finalTest,
  };
  if (
    selected.some(
      (row) =>
        row.cutoff < Date.parse(windows[row.partition].from) ||
        row.cutoff >= Date.parse(windows[row.partition].to)
    )
  )
    throw new RangeError('Native PAV observations must remain inside the protocol windows.');
  const training = selected.filter((row) => row.partition === 'train');
  if (
    training.some(
      (row) =>
        row.target === null ||
        row.forecastUnavailable !== null ||
        row.labelAvailableAt >= Date.parse(protocol.content.windows.calibration.from)
    )
  )
    throw new RangeError(
      'Every selected training observation needs an available pre-calibration target.'
    );
  const bindings = {
    schemaVersion: 'afl-trade-admitted-player-pav-candidate/v1' as const,
    authorityBoundary: 'numerical_fit_only_no_execution_or_qualification_authority' as const,
    publicationEligible: false as const,
    intentId: intent.intentId,
    protocolId: protocol.protocolId,
    datasetId: input.datasetCandidate.datasetId,
    datasetAdmissionId: intent.content.datasetAdmissionId,
    observationSetId: projection.observationSetId,
    pavObservationSetId: original.observationSetId,
    pavPolicyId: original.content.policy.policyId,
    methodId: method.methodId,
    configurationArtifact: intent.content.configurationArtifact,
    trainingObservationIds: training.map(({ observationId }) => observationId),
  };
  return { bindings, selected, training, configuration };
}

/** Produces numerical state only; caller must separately retain bytes and enforce run authority. */
export function fitAflTradeAdmittedPlayerPavCandidate(
  input: AflTradeAdmittedPlayerPavFitInput
): AflTradeAdmittedPlayerPavCandidate {
  const { bindings, training, configuration } = authenticate(input);
  const fitState = fitPlayerPavForecast(training, configuration.candidate).state;
  const content = { ...bindings, fitState };
  return aflTradeAdmittedPlayerPavCandidateSchema.parse({
    candidateId: createAflTradeContentAddress('admitted-player-pav-candidate', content),
    content,
  });
}

/** Restores exact numerical state without refitting or granting execution/qualification authority. */
export function restoreAflTradeAdmittedPlayerPavCandidate(
  unparsed: unknown,
  input: AflTradeAdmittedPlayerPavFitInput
) {
  const candidate = aflTradeAdmittedPlayerPavCandidateSchema.parse(unparsed);
  const { bindings, selected, configuration } = authenticate(input);
  const { fitState, ...retainedBindings } = candidate.content;
  const state = fitState.content;
  const choice =
    state.kind === 'ridge'
      ? { kind: state.kind, historySeasons: state.historySeasons, penalty: state.penalty }
      : state.kind === 'shrinkage'
        ? {
            kind: state.kind,
            historySeasons: state.historySeasons,
            pseudoSeasons: state.pseudoSeasons,
          }
        : { kind: state.kind, historySeasons: state.historySeasons };
  if (
    canonicalizeAflTradeJson(bindings) !== canonicalizeAflTradeJson(retainedBindings) ||
    canonicalizeAflTradeJson(choice) !== canonicalizeAflTradeJson(configuration.candidate)
  )
    throw new RangeError(
      'Retained native PAV candidate differs from its exact parents or configuration.'
    );
  const fitted = restorePlayerPavForecast(fitState);
  const selectedById = new Map(selected.map((row) => [row.observationId, row]));
  return {
    candidate,
    predict(observationId: string) {
      const row = selectedById.get(observationId);
      if (!row) throw new RangeError('PAV prediction requires an exact selected observation.');
      const annualPav = fitted.predict(row);
      const totalPav = annualPav.reduce((total, value) => total + value, 0);
      if (!Number.isFinite(totalPav))
        throw new RangeError('Native PAV total prediction must remain finite.');
      return { annualPav, totalPav };
    },
  };
}
