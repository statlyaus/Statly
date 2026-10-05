import {
  resolveAflTradeGateEligibility,
  type AflTradeGateDecisionLedger,
} from '../governance/gateDecisionLedger';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
  type AflTradeGateDecisionProposal,
  type AflTradeGateDecisionRecord,
  type AflTradeGovernedArtifactRef,
} from '../governance/gateDecisionTypes';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';

interface GateChainRow {
  proposal_json: unknown;
  decision_json: unknown | null;
}

export interface AflTradeCurrentGateAuthority {
  proposal: AflTradeGateDecisionProposal;
  decision: AflTradeGateDecisionRecord;
  validThrough: string;
}

function exactArtifacts(
  actual: readonly AflTradeGovernedArtifactRef[],
  expected: readonly AflTradeGovernedArtifactRef[]
): boolean {
  const identity = ({ kind, artifactId }: AflTradeGovernedArtifactRef) =>
    `${kind}|${artifactId}`;
  const left = actual.map(identity).sort();
  const right = expected.map(identity).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function loadCurrentAflTradeGateAuthority(
  transaction: AflOutcomeSqlTransaction,
  input: {
    decisionId: string;
    valuationScopeKey: string;
    trustedAt: string;
    expectedArtifacts: readonly AflTradeGovernedArtifactRef[];
  }
): Promise<AflTradeCurrentGateAuthority | null> {
  const result = await transaction.query<GateChainRow>(
    `WITH target AS (
       SELECT gate,environment,decision_key
         FROM outcome_gate_decision WHERE decision_id=$1
     )
     SELECT proposal.proposal_json,decision.decision_json
       FROM target
       JOIN outcome_gate_proposal proposal
         ON proposal.gate=target.gate
        AND proposal.environment=target.environment
        AND proposal.decision_key=target.decision_key
  LEFT JOIN outcome_gate_decision decision
         ON decision.proposal_id=proposal.proposal_id
      ORDER BY proposal.version
      FOR KEY SHARE OF proposal,decision`,
    [input.decisionId]
  );
  const proposals: AflTradeGateDecisionProposal[] = [];
  const decisions: AflTradeGateDecisionRecord[] = [];
  for (const row of result.rows) {
    proposals.push(aflTradeGateDecisionProposalSchema.parse(row.proposal_json));
    if (row.decision_json !== null) {
      decisions.push(aflTradeGateDecisionRecordSchema.parse(row.decision_json));
    }
  }
  const ledger: AflTradeGateDecisionLedger = { proposals, decisions };
  const requested = decisions.find(({ decisionId }) => decisionId === input.decisionId);
  if (requested === undefined) return null;
  const resolution = resolveAflTradeGateEligibility(ledger, {
    gate: 'gate_3_model_validity',
    decisionKey: requested.content.decisionKey,
    environment: 'non_production',
    evaluatedAt: input.trustedAt,
  });
  if (
    resolution.status !== 'mechanically_eligible' ||
    resolution.decision?.decisionId !== input.decisionId ||
    requested.content.authorityKind !== 'external_human_record' ||
    requested.content.scope.scopeKey !== input.valuationScopeKey ||
    requested.content.revalidateAt === null ||
    !exactArtifacts(requested.content.affectedArtifacts, input.expectedArtifacts)
  ) {
    return null;
  }
  const proposal = proposals.find(
    ({ proposalId }) => proposalId === requested.content.proposalId
  );
  if (
    proposal === undefined ||
    proposal.content.scope.scopeKey !== input.valuationScopeKey ||
    !exactArtifacts(proposal.content.affectedArtifacts, input.expectedArtifacts)
  ) {
    throw new TypeError('Gate 3 proposal and decision ancestry failed exact authentication.');
  }
  return { proposal, decision: requested, validThrough: requested.content.revalidateAt };
}
