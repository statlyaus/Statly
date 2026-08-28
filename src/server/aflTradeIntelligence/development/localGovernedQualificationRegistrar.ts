import type { AflTradeArtifactRef } from '../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import type { AflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import {
  createAflTradeDispatchBoundQualificationRegistrar,
  type AflTradeDispatchBoundQualificationExecutorInput,
} from '../valuation/postgresPrivateValuationModelPair';
import {
  createGovernedValuationModelQualificationGateRecords,
  deriveGovernedPickModelQualificationEvidence,
  deriveGovernedPlayerModelQualificationEvidence,
  governedValuationModelQualificationPolicySchema,
} from '../valuation/internal/governedValuationModelQualification';
import { loadGovernedNativeComponentValidationReport } from '../valuation/internal/governedNativeComponentExecution';
import type { PostgresGovernedValuationComponentRunRepository } from '../valuation/internal/postgresGovernedValuationComponentRunRepository';
import type { PostgresGovernedValuationModelQualificationRepository } from '../valuation/internal/postgresGovernedValuationModelQualificationRepository';

type QualificationPolicy = ReturnType<typeof governedValuationModelQualificationPolicySchema.parse>;

export function createLocalAflTradeGovernedQualificationRegistrar(input: {
  readonly componentRepository: Pick<PostgresGovernedValuationComponentRunRepository, 'loadExact'>;
  readonly qualificationRepository: Pick<
    PostgresGovernedValuationModelQualificationRepository,
    'register' | 'loadCurrent'
  >;
  readonly artifactRepository: AflTradeImmutableArtifactRepository;
  readonly maximumArtifactBytes: number;
  readonly gateDecisionLedgerRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load'>;
  readonly policy: QualificationPolicy;
  readonly now: () => Promise<string>;
  readonly retainCanonical: (input: {
    readonly document: unknown;
    readonly createdAt: string;
  }) => Promise<AflTradeArtifactRef>;
  readonly automationPrincipal: string;
  readonly accountableOwner: string;
}) {
  const policy = governedValuationModelQualificationPolicySchema.parse(input.policy);
  return createAflTradeDispatchBoundQualificationRegistrar({
    repository: input.qualificationRepository,
    retainArtifact: input.retainCanonical,
    async prepareQualification(execution: AflTradeDispatchBoundQualificationExecutorInput) {
      const [player, pick, evaluatedAt] = await Promise.all([
        input.componentRepository.loadExact(execution.playerRunId),
        input.componentRepository.loadExact(execution.pickRunId),
        input.now(),
      ]);
      const [playerNative, pickNative] = await Promise.all([
        loadGovernedNativeComponentValidationReport({
          manifest: player.manifest,
          artifactRepository: input.artifactRepository,
          maximumArtifactBytes: input.maximumArtifactBytes,
        }),
        loadGovernedNativeComponentValidationReport({
          manifest: pick.manifest,
          artifactRepository: input.artifactRepository,
          maximumArtifactBytes: input.maximumArtifactBytes,
        }),
      ]);
      if (
        playerNative.kind !== 'player_contribution_and_availability' ||
        pickNative.kind !== 'draft_pick_and_future_pick_distribution'
      ) {
        throw new TypeError('Qualification components do not have the exact governed roles.');
      }
      const playerEvidence = deriveGovernedPlayerModelQualificationEvidence(
        playerNative.validationReport
      );
      const pickEvidence = deriveGovernedPickModelQualificationEvidence(
        pickNative.validationReport
      );
      const [
        policyArtifact,
        playerCriteriaArtifact,
        pickCriteriaArtifact,
        playerEvidenceArtifact,
        pickEvidenceArtifact,
      ] = await Promise.all([
        input.retainCanonical({ document: policy, createdAt: evaluatedAt }),
        input.retainCanonical({ document: policy.player, createdAt: evaluatedAt }),
        input.retainCanonical({ document: policy.pick, createdAt: evaluatedAt }),
        input.retainCanonical({ document: playerEvidence, createdAt: evaluatedAt }),
        input.retainCanonical({ document: pickEvidence, createdAt: evaluatedAt }),
      ]);
      return {
        environment: 'non_production' as const,
        scopeKey: execution.operation.content.scopeKey,
        evaluatedAt,
        policy,
        policyArtifact,
        components: {
          player: {
            role: player.manifest.content.role as 'player_contribution_and_availability',
            runId: player.manifest.runId,
            runArtifact: player.artifact,
            protocolId: player.manifest.content.protocolId,
            protocolArtifact: player.manifest.content.protocolArtifact,
            criteriaArtifact: playerCriteriaArtifact,
            validationEvidence: playerEvidence,
            validationEvidenceArtifact: playerEvidenceArtifact,
          },
          pick: {
            role: pick.manifest.content.role as 'draft_pick_and_future_pick_distribution',
            runId: pick.manifest.runId,
            runArtifact: pick.artifact,
            protocolId: pick.manifest.content.protocolId,
            protocolArtifact: pick.manifest.content.protocolArtifact,
            criteriaArtifact: pickCriteriaArtifact,
            validationEvidence: pickEvidence,
            validationEvidenceArtifact: pickEvidenceArtifact,
          },
        },
      };
    },
    async prepareRegistration({ execution, qualification, qualificationArtifact }) {
      const [gate, current] = await Promise.all([
        input.gateDecisionLedgerRepository.load(),
        input.qualificationRepository.loadCurrent(execution.operation.content.scopeKey),
      ]);
      if (qualification.content.outcome === 'failed') {
        return {
          expectedGateLedgerRevision: gate.revision,
          expectedCurrentRevision: current?.revision ?? 0,
        };
      }
      const version = (current?.revision ?? 0) + 1;
      return {
        expectedGateLedgerRevision: gate.revision,
        expectedCurrentRevision: current?.revision ?? 0,
        gateRecords: createGovernedValuationModelQualificationGateRecords({
          qualification,
          qualificationArtifact,
          decidedAt: qualification.content.evaluatedAt,
          automationPrincipal: input.automationPrincipal,
          accountableOwner: input.accountableOwner,
          versions: { player: version, pick: version },
          supersedes: {
            player: current?.playerGate3DecisionId ?? null,
            pick: current?.pickGate3DecisionId ?? null,
          },
        }),
      };
    },
  });
}
