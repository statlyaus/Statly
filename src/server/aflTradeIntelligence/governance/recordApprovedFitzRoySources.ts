import {
  createApprovedAflTradeFitzRoyGateRecords,
  type ApprovedAflTradeFitzRoyGateRecordsInput,
} from '../source/approvedFitzRoyGateRecords';
import {
  createApprovedAflTradeFitzRoySourcePolicies,
  type ApprovedAflTradeFitzRoySourcePolicyInput,
} from '../source/approvedFitzRoySourcePolicies';
import type { AflTradeSourceRightsProposal } from '../source/sourceContracts';
import type {
  AflTradeGateDecisionLedgerRepository,
  AflTradeStoredGateLedger,
} from './postgresGateDecisionLedgerRepository';
import type { AflTradeGateDecisionProposal, AflTradeGateDecisionRecord } from './gateDecisionTypes';

export interface RecordApprovedAflTradeFitzRoySourcesInput {
  policy: ApprovedAflTradeFitzRoySourcePolicyInput;
  gate: Omit<
    ApprovedAflTradeFitzRoyGateRecordsInput,
    'sourceRights' | 'version' | 'supersedesDecisionId'
  >;
}

export interface RecordedApprovedAflTradeFitzRoySource {
  sourceRights: AflTradeSourceRightsProposal;
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
  idempotentReplay: boolean;
}

export interface RecordApprovedAflTradeFitzRoySourcesResult extends AflTradeStoredGateLedger {
  records: readonly RecordedApprovedAflTradeFitzRoySource[];
}

function decisionKeyFor(
  sourceRights: AflTradeSourceRightsProposal,
  environment: RecordApprovedAflTradeFitzRoySourcesInput['gate']['environment']
): string {
  if (sourceRights.content.acquisition.kind !== 'fitzroy') {
    throw new TypeError('Approved fitzRoy source recording requires a fitzRoy policy.');
  }
  const capability = sourceRights.content.acquisition.capabilities[0];
  if (capability === undefined) {
    throw new TypeError('Approved fitzRoy source recording requires exactly one capability.');
  }
  return `${capability.capabilityId}-${environment}`;
}

function currentDecisionFor(
  ledger: AflTradeStoredGateLedger['ledger'],
  decisionKey: string,
  environment: RecordApprovedAflTradeFitzRoySourcesInput['gate']['environment']
): AflTradeGateDecisionRecord | undefined {
  return ledger.decisions
    .filter(
      (decision) =>
        decision.content.gate === 'gate_0a_permission_to_evaluate' &&
        decision.content.environment === environment &&
        decision.content.decisionKey === decisionKey
    )
    .sort((left, right) => left.content.version - right.content.version)
    .at(-1);
}

export async function recordApprovedAflTradeFitzRoySources(
  repository: AflTradeGateDecisionLedgerRepository,
  input: RecordApprovedAflTradeFitzRoySourcesInput
): Promise<RecordApprovedAflTradeFitzRoySourcesResult> {
  const sourcePolicies = createApprovedAflTradeFitzRoySourcePolicies(input.policy);
  const stored = await repository.load();
  const pending = sourcePolicies.map((sourceRights) => {
    const current = currentDecisionFor(
      stored.ledger,
      decisionKeyFor(sourceRights, input.gate.environment),
      input.gate.environment
    );
    const currentVersionRecords = createApprovedAflTradeFitzRoyGateRecords({
      ...input.gate,
      sourceRights,
      version: current?.content.version ?? 1,
      supersedesDecisionId: current?.content.supersedesDecisionId ?? null,
    });
    if (
      current === undefined ||
      (currentVersionRecords.decision.decisionId === current.decisionId &&
        stored.ledger.proposals.some(
          ({ proposalId }) => proposalId === currentVersionRecords.proposal.proposalId
        ))
    ) {
      return { sourceRights, ...currentVersionRecords };
    }
    return {
      sourceRights,
      ...createApprovedAflTradeFitzRoyGateRecords({
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
  const records = pending.map((record, index) => ({
    ...record,
    idempotentReplay: persisted.idempotentReplays[index] ?? false,
  }));

  return { revision: persisted.revision, ledger: persisted.ledger, records };
}
