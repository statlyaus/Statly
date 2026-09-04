import {
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  doesAflTradeArtifactRefMatchCanonicalJson,
  type AflTradeArtifactRef,
} from '../../artifacts/artifactReference';
import { canonicalizeAflTradeJson } from '../../artifacts/contentAddress';
import { aflTradeValuationInputBundleSchema } from '../../artifacts/valuationInputBundle';
import {
  verifyAflTradeArtifactReadback,
  type AflTradeImmutableArtifactRepository,
} from '../../artifacts/immutableArtifactRepository';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../../outcomes/postgresOutcomeReleaseRepository';
import { aflTradePreparedValuationInputEntryV3Schema } from '../preparedValuationInputSet';
import {
  AflTradePreparedValuationInputCohortCache,
  loadCurrentAflTradePreparedValuationInputTradeFromTransaction,
} from '../postgresPreparedValuationInputSetStore';
import { aflTradeValuationCalculationInputPackageSchema } from '../valuationCalculationInputPackage';
import { governedPrivateEvaluationInputTraceSchema } from './governedPrivateEvaluationInputTrace';
import { capturePostgresGovernedPrivateEvaluationCurrentAuthority } from './postgresGovernedPrivateEvaluationCurrentAuthority';
import type { GovernedPrivateEvaluationCapturedCalculationAuthority } from './postgresGovernedPrivateEvaluationInspectionRepository';
import { PostgresGovernedPrivateEvaluationMaterializationManifestRepository } from './postgresGovernedPrivateEvaluationMaterializationManifestRepository';

const BLOCKER_MESSAGES = {
  source_blocked: 'The current factual source authority blocks this calculation.',
  model_not_approved:
    'The required model component is not part of the exact current automated qualification.',
  insufficient_data: 'The prepared evidence is insufficient for this calculation.',
  identity_unresolved: 'A required trade or asset identity remains unresolved.',
  lineage_unresolved: 'A required asset lineage remains unresolved.',
  unsupported_trade: 'This trade shape is not yet supported by the authenticated calculation path.',
  component_output_unavailable: 'A required governed model output is unavailable.',
  policy_unavailable: 'A required calculation policy is unavailable.',
  temporal_evidence_unavailable: 'Required season or cutoff evidence is unavailable.',
} as const;

type CapturedBlocker = Extract<
  GovernedPrivateEvaluationCapturedCalculationAuthority,
  { state: 'unavailable' }
>['blockers'][number];

function inspectionBlocker(blocker: {
  readonly code: keyof typeof BLOCKER_MESSAGES;
  readonly subject: { readonly kind: string; readonly id: string };
}): CapturedBlocker {
  const code =
    blocker.code === 'component_output_unavailable'
      ? 'model_not_approved'
      : blocker.code === 'policy_unavailable' ||
          blocker.code === 'temporal_evidence_unavailable' ||
          blocker.code === 'unsupported_trade'
        ? 'insufficient_data'
        : blocker.code;
  return {
    code,
    message: `${BLOCKER_MESSAGES[blocker.code]} (${blocker.subject.kind}:${blocker.subject.id})`,
  };
}

function transactionClient(transaction: AflOutcomeSqlTransaction): AflOutcomeSqlClient {
  return {
    query: transaction.query.bind(transaction),
    transaction: async (work) => work(transaction),
  };
}

async function loadJsonArtifact(input: {
  readonly repository: AflTradeImmutableArtifactRepository;
  readonly reference: AflTradeArtifactRef;
  readonly maximumBytes: number;
}): Promise<unknown> {
  const loaded = await input.repository.loadExact(input.reference, input.maximumBytes);
  if (
    loaded === null ||
    !doAflTradeArtifactRefsExactlyMatch(loaded.reference, input.reference) ||
    !doesAflTradeArtifactRefMatchBytes(loaded.reference, loaded.bytes)
  ) {
    throw new TypeError('Retained calculation artifact failed exact byte authentication.');
  }
  try {
    return JSON.parse(new TextDecoder().decode(loaded.bytes));
  } catch {
    throw new TypeError('Retained calculation artifact is not valid JSON.');
  }
}

export function createPostgresGovernedPrivateEvaluationCalculationAuthorityCapture(dependencies: {
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly preparedInputCache?: AflTradePreparedValuationInputCohortCache;
}) {
  if (
    dependencies.artifactRepository.artifactClass !== 'derived_private' ||
    !Number.isSafeInteger(dependencies.maximumArtifactBytes) ||
    dependencies.maximumArtifactBytes <= 0
  ) {
    throw new TypeError('Calculation-authority capture requires bounded private artifact custody.');
  }
  return async function capture(input: {
    readonly transaction: Parameters<
      typeof loadCurrentAflTradePreparedValuationInputTradeFromTransaction
    >[0];
    readonly selector: { readonly valuationScopeKey: string; readonly tradeId: string };
    readonly capturedAt: string;
  }): Promise<GovernedPrivateEvaluationCapturedCalculationAuthority> {
    const current = await loadCurrentAflTradePreparedValuationInputTradeFromTransaction(
      input.transaction,
      { scopeKey: input.selector.valuationScopeKey, tradeId: input.selector.tradeId },
      dependencies.preparedInputCache
    );
    if (current === null) {
      return {
        state: 'unavailable',
        blockers: [
          {
            code: 'insufficient_data',
            message: 'No current authenticated v3 prepared calculation inputs cover this trade.',
          },
        ],
      };
    }
    const prepared = current.preparedInputSet.content;
    if (prepared.schemaVersion !== 'afl-trade-prepared-valuation-input-set/v3') {
      throw new TypeError('Current calculation authority is not an authenticated v3 prepared set.');
    }
    if (prepared.preparationAuthority !== 'authenticated_calculation_evidence_snapshot') {
      throw new TypeError(
        'Private current-model prepared inputs require dispatch-fenced cohort execution.'
      );
    }
    const entry = aflTradePreparedValuationInputEntryV3Schema.parse(current.entry);
    if (entry.state === 'blocked') {
      return {
        state: 'unavailable',
        blockers: entry.blockers.map(inspectionBlocker),
      };
    }
    const materialization =
      await new PostgresGovernedPrivateEvaluationMaterializationManifestRepository(
        transactionClient(input.transaction)
      ).loadExact(entry.materializationManifestId);
    if (
      materialization.manifest.manifestId !== entry.materializationManifestId ||
      !doAflTradeArtifactRefsExactlyMatch(
        materialization.artifact,
        entry.materializationManifestArtifact
      ) ||
      materialization.manifest.content.selector.valuationScopeKey !==
        input.selector.valuationScopeKey ||
      materialization.manifest.content.selector.tradeId !== input.selector.tradeId
    ) {
      throw new TypeError(
        'Prepared calculation authority disagrees with its exact retained materialization manifest.'
      );
    }
    await verifyAflTradeArtifactReadback(
      dependencies.artifactRepository,
      materialization.artifact,
      input.capturedAt,
      dependencies.maximumArtifactBytes
    );
    const manifest = materialization.manifest.content;
    const parentArtifacts = [
      prepared.factualReleaseArtifact,
      prepared.releaseMembershipArtifact,
      prepared.qualificationReportArtifact,
      ...prepared.sourceQualificationEvidenceRefs,
      prepared.valuationInputBundleArtifact,
      manifest.calculationInputArtifact,
      manifest.inputTraceArtifact,
      manifest.explanationPolicyArtifact,
      manifest.lineageGraphArtifact,
      ...manifest.pickBenchmarks.map(({ artifact }) => artifact),
      ...manifest.playerObservations.map(({ artifact }) => artifact),
    ];
    for (const artifact of parentArtifacts) {
      await verifyAflTradeArtifactReadback(
        dependencies.artifactRepository,
        artifact,
        input.capturedAt,
        dependencies.maximumArtifactBytes
      );
    }
    const valuationInputBundle = aflTradeValuationInputBundleSchema.safeParse(
      await loadJsonArtifact({
        repository: dependencies.artifactRepository,
        reference: prepared.valuationInputBundleArtifact,
        maximumBytes: dependencies.maximumArtifactBytes,
      })
    );
    if (!valuationInputBundle.success) {
      throw new TypeError('Retained valuation input bundle failed exact contract authentication.');
    }
    const bundle = valuationInputBundle.data;
    const nestedBundleArtifacts = [
      bundle.content.packagePolicy.listSpotPolicyArtifact,
      bundle.content.packagePolicy.scarcityPolicyArtifact,
      bundle.content.packagePolicy.roleCongestionPolicyArtifact,
      bundle.content.simulation.lowReturnDefinitionArtifact,
      bundle.content.simulation.eliteOutcomeDefinitionArtifact,
      bundle.content.simulation.practicalEquivalenceDefinitionArtifact,
      bundle.content.explanationPolicyArtifact,
    ];
    for (const artifact of nestedBundleArtifacts) {
      await verifyAflTradeArtifactReadback(
        dependencies.artifactRepository,
        artifact,
        input.capturedAt,
        dependencies.maximumArtifactBytes
      );
    }
    const inputTrace = governedPrivateEvaluationInputTraceSchema.safeParse(
      await loadJsonArtifact({
        repository: dependencies.artifactRepository,
        reference: manifest.inputTraceArtifact,
        maximumBytes: dependencies.maximumArtifactBytes,
      })
    );
    const calculationInput = aflTradeValuationCalculationInputPackageSchema.safeParse(
      await loadJsonArtifact({
        repository: dependencies.artifactRepository,
        reference: manifest.calculationInputArtifact,
        maximumBytes: dependencies.maximumArtifactBytes,
      })
    );
    if (!inputTrace.success || !calculationInput.success) {
      throw new TypeError('Retained calculation trace or package failed exact authentication.');
    }
    const trace = inputTrace.data;
    const calculation = calculationInput.data;
    const bundleComponents = bundle.content.components.map(
      ({ role, runId, protocolId, datasetId, gate3DecisionId }) => ({
        role,
        runId,
        protocolId,
        datasetId,
        gate3DecisionId,
      })
    );
    const traceComponents = trace.content.components.map(
      ({ role, runId, protocolId, datasetId, gate3DecisionId }) => ({
        role,
        runId,
        protocolId,
        datasetId,
        gate3DecisionId,
      })
    );
    if (
      bundle.valuationInputBundleId !== prepared.valuationInputBundleId ||
      bundle.content.scopeKey !== input.selector.valuationScopeKey ||
      trace.inputTraceId !== manifest.inputTraceId ||
      !doesAflTradeArtifactRefMatchCanonicalJson(manifest.inputTraceArtifact, trace) ||
      trace.content.selector.valuationScopeKey !== input.selector.valuationScopeKey ||
      trace.content.selector.tradeId !== input.selector.tradeId ||
      trace.content.factualReleaseId !== prepared.factualReleaseId ||
      trace.content.valuationInputBundleId !== bundle.valuationInputBundleId ||
      canonicalizeAflTradeJson(traceComponents) !== canonicalizeAflTradeJson(bundleComponents) ||
      calculation.calculationInputPackageId !== manifest.calculationInputPackageId ||
      !doesAflTradeArtifactRefMatchCanonicalJson(manifest.calculationInputArtifact, calculation) ||
      calculation.content.tradeId !== input.selector.tradeId ||
      calculation.content.valuationInputBundleId !== bundle.valuationInputBundleId ||
      calculation.content.authority.kind !== 'authenticated_non_production' ||
      calculation.content.authority.inputTraceId !== trace.inputTraceId
    ) {
      throw new TypeError(
        'Retained prepared inputs, bundle, trace, and calculation package do not share exact ancestry.'
      );
    }
    return capturePostgresGovernedPrivateEvaluationCurrentAuthority({
      transaction: input.transaction,
      selector: input.selector,
      capturedAt: input.capturedAt,
      prepared,
      trace,
      materializationManifestId: materialization.manifest.manifestId,
      materializationManifestArtifact: materialization.artifact,
      valuationInputBundleId: bundle.valuationInputBundleId,
      valuationInputBundleArtifact: prepared.valuationInputBundleArtifact,
      preparedInputHeadRevision: current.head.revision,
      preparedInputSetId: current.head.preparedInputSetId,
      artifactRepository: dependencies.artifactRepository,
      maximumArtifactBytes: dependencies.maximumArtifactBytes,
    });
  };
}
