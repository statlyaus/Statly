import type { AflTradeGateDecisionProposal, AflTradeGateDecisionRecord } from './gateDecisionTypes';
import type {
  AflTradeGateDecisionLedgerRepository,
  AflTradeStoredGateLedger,
} from './postgresGateDecisionLedgerRepository';
import {
  createApprovedAflTradeExternalGateRecords,
  type ApprovedAflTradeExternalGateRecordsInput,
} from '../source/approvedExternalDraftTradeGateRecords';
import {
  createApprovedAflTradeExternalSourcePolicies,
  type ApprovedAflTradeExternalSourcePolicyInput,
} from '../source/approvedExternalDraftTradeSourcePolicies';
import type { AflTradeSourceRightsProposal } from '../source/sourceContracts';

export interface RecordApprovedAflTradeExternalSourcesInput {
  policy: ApprovedAflTradeExternalSourcePolicyInput;
  gate: Omit<
    ApprovedAflTradeExternalGateRecordsInput,
    'sourceRights' | 'version' | 'supersedesDecisionId'
  >;
}

export interface RecordedApprovedAflTradeExternalSource {
  sourceRights: AflTradeSourceRightsProposal;
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
  idempotentReplay: boolean;
}

export interface RecordApprovedAflTradeExternalSourcesResult extends AflTradeStoredGateLedger {
  records: readonly RecordedApprovedAflTradeExternalSource[];
}

function decisionKey(sourceRights: AflTradeSourceRightsProposal): string {
  if (sourceRights.content.acquisition.kind !== 'provider_web') {
    throw new TypeError('External source recording requires provider-web source rights.');
  }
  return `${sourceRights.content.acquisition.capabilityId}-production`;
}

function currentDecision(
  ledger: AflTradeStoredGateLedger['ledger'],
  key: string
): AflTradeGateDecisionRecord | undefined {
  return ledger.decisions
    .filter(
      (decision) =>
        decision.content.gate === 'gate_0a_permission_to_evaluate' &&
        decision.content.environment === 'production' &&
        decision.content.decisionKey === key
    )
    .sort((left, right) => left.content.version - right.content.version)
    .at(-1);
}

export async function recordApprovedAflTradeExternalSources(
  repository: AflTradeGateDecisionLedgerRepository,
  input: RecordApprovedAflTradeExternalSourcesInput
): Promise<RecordApprovedAflTradeExternalSourcesResult> {
  const sourcePolicies = createApprovedAflTradeExternalSourcePolicies(input.policy);
  const stored = await repository.load();
  const pending = sourcePolicies.map((sourceRights) => {
    const current = currentDecision(stored.ledger, decisionKey(sourceRights));
    const sameVersion = createApprovedAflTradeExternalGateRecords({
      ...input.gate,
      sourceRights,
      version: current?.content.version ?? 1,
      supersedesDecisionId: current?.content.supersedesDecisionId ?? null,
    });
    if (
      current === undefined ||
      (sameVersion.decision.decisionId === current.decisionId &&
        stored.ledger.proposals.some(
          ({ proposalId }) => proposalId === sameVersion.proposal.proposalId
        ))
    ) {
      return { sourceRights, ...sameVersion };
    }
    return {
      sourceRights,
      ...createApprovedAflTradeExternalGateRecords({
        ...input.gate,
        sourceRights,
        version: current.content.version + 1,
        supersedesDecisionId: current.decisionId,
      }),
    };
  });
  const persisted = await repository.appendBatch({
    expectedRevision: stored.revision,
    records: pending,
  });
  return {
    revision: persisted.revision,
    ledger: persisted.ledger,
    records: pending.map((record, index) => ({
      ...record,
      idempotentReplay: persisted.idempotentReplays[index] ?? false,
    })),
  };
}
