import { resolveAflTradeGateEligibility } from '../governance/gateDecisionLedger';
import type { AflTradeDecisionEnvironment } from '../governance/gateDecisionTypes';
import type { AflTradeGateDecisionLedgerRepository } from '../governance/postgresGateDecisionLedgerRepository';
import type { AflTradePublicationRepository } from './postgresPublicationRepository';
import { captureAflTradePublicationRead, type AflTradePublicationRecord } from './publicationState';
import type { AflTradePublicationSelector } from './valueReadService';

function hasCurrentDecision(input: {
  record: AflTradePublicationRecord;
  decisionId: string | null;
  gate: 'gate_4_publication_api_readiness' | 'gate_5_comprehension_accessibility';
  ledger: Awaited<ReturnType<AflTradeGateDecisionLedgerRepository['load']>>['ledger'];
  environment: AflTradeDecisionEnvironment;
  evaluatedAt: string;
}): boolean {
  if (input.decisionId === null || input.record.projectionId === null) return false;
  const decision = input.ledger.decisions.find(
    (candidate) => candidate.decisionId === input.decisionId
  );
  if (decision?.content.gate !== input.gate) return false;
  const eligibility = resolveAflTradeGateEligibility(input.ledger, {
    gate: input.gate,
    decisionKey: decision.content.decisionKey,
    environment: input.environment,
    evaluatedAt: input.evaluatedAt,
  });
  if (
    eligibility.status !== 'mechanically_eligible' ||
    eligibility.decision?.decisionId !== input.decisionId
  ) {
    return false;
  }
  return [
    { kind: 'publication', artifactId: input.record.publicationId },
    { kind: 'projection', artifactId: input.record.projectionId },
  ].every((required) =>
    decision.content.affectedArtifacts.some(
      (artifact) => artifact.kind === required.kind && artifact.artifactId === required.artifactId
    )
  );
}

export function createGovernedAflTradePublicationSelector(input: {
  publicationRepository: Pick<AflTradePublicationRepository, 'load'>;
  gateRepository: Pick<AflTradeGateDecisionLedgerRepository, 'load'>;
  environment: AflTradeDecisionEnvironment;
  now: () => string;
}): AflTradePublicationSelector {
  return {
    async capture(scopeKey) {
      const [registry, gateState] = await Promise.all([
        input.publicationRepository.load(),
        input.gateRepository.load(),
      ]);
      const selection = captureAflTradePublicationRead(registry, scopeKey);
      if (selection === null) {
        return {
          registryRevision: registry.revision,
          selection: null,
          unavailabilityReason: 'no_active_publication' as const,
        };
      }
      const record = registry.publications[selection.publication.publicationId];
      const evaluatedAt = input.now();
      if (
        record === undefined ||
        !hasCurrentDecision({
          record,
          decisionId: record.gate4DecisionId,
          gate: 'gate_4_publication_api_readiness',
          ledger: gateState.ledger,
          environment: input.environment,
          evaluatedAt,
        }) ||
        !hasCurrentDecision({
          record,
          decisionId: record.gate5DecisionId,
          gate: 'gate_5_comprehension_accessibility',
          ledger: gateState.ledger,
          environment: input.environment,
          evaluatedAt,
        })
      ) {
        return {
          registryRevision: registry.revision,
          selection: null,
          unavailabilityReason: 'source_blocked' as const,
        };
      }
      return { registryRevision: registry.revision, selection };
    },
  };
}
