import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { PrivateEvaluationInspectionBlocker } from './governedPrivateTradeEvaluationContracts';
import {
  loadCurrentAflTradeGateAuthority,
  type AflTradeCurrentGateAuthority,
} from './postgresCurrentGateAuthority';
import {
  loadAuthenticatedAflTradePrivateValuationAuthorityBundleChain,
  type AflTradeAuthenticatedPrivateValuationAuthorityBundleChain,
} from './postgresPrivateValuationAuthorityBundleRegistry';
import type { PrivateEvaluationAuthorityEvidence } from './postgresPrivateEvaluationInspectionStore';

interface BundleGateCandidateRow {
  decision_id: string;
  valuation_bundle_id: string;
}

export interface PrivateValuationModelAuthorityInspection {
  evidence: readonly PrivateEvaluationAuthorityEvidence[];
  blockers: readonly PrivateEvaluationInspectionBlocker[];
  validThrough: string | null;
  currentValuationAsOf: string | null;
  hpnPavMethodId: string | null;
  factualCandidateId: string | null;
}

function blocker(
  code:
    | 'player_model_run_not_authorized'
    | 'pick_model_run_not_authorized'
    | 'player_gate3_not_approved'
    | 'pick_gate3_not_approved'
    | 'valuation_bundle_not_authorized',
  authorityClass: 'model_run' | 'gate_3' | 'valuation_bundle',
  message: string
): PrivateEvaluationInspectionBlocker {
  return {
    code,
    authorityClass,
    classification: 'external_authority',
    assetId: null,
    message,
    evidenceRefs: [],
  };
}

function unavailableAll(): PrivateValuationModelAuthorityInspection {
  return {
    evidence: [],
    validThrough: null,
    currentValuationAsOf: null,
    hpnPavMethodId: null,
    factualCandidateId: null,
    blockers: [
      blocker(
        'player_model_run_not_authorized',
        'model_run',
        'No succeeded governed player model run is bound to the selected factual release.'
      ),
      blocker(
        'pick_model_run_not_authorized',
        'model_run',
        'No governed pick model candidate is bound to the selected factual release.'
      ),
      blocker(
        'player_gate3_not_approved',
        'gate_3',
        'No current non-production Gate 3 decision approves the governed player model run.'
      ),
      blocker(
        'pick_gate3_not_approved',
        'gate_3',
        'No current non-production Gate 3 decision approves the governed pick model candidate.'
      ),
      blocker(
        'valuation_bundle_not_authorized',
        'valuation_bundle',
        'No current governed valuation bundle and Gate 3 decision are retained.'
      ),
    ],
  };
}

function modelEvidence(
  chain: AflTradeAuthenticatedPrivateValuationAuthorityBundleChain,
  gates: readonly AflTradeCurrentGateAuthority[]
): PrivateEvaluationAuthorityEvidence[] {
  const { bundle } = chain;
  const evidence: PrivateEvaluationAuthorityEvidence[] = [];
  const seen = new Set<string>();
  const append = (
    item: Extract<PrivateEvaluationAuthorityEvidence, { source: 'postgres_json' }>
  ) => {
    const identity = `${item.role}|${canonicalizeAflTradeJson(item.document)}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    evidence.push(item);
  };
  for (const authority of [
    chain.modelAuthorities.atTrade,
    chain.modelAuthorities.currentRemaining,
  ]) {
    const { player, pick } = authority;
    append({ role: 'dataset_admission', source: 'postgres_json', document: player.dataset, createdAt: player.dataset.content.createdAt });
    append({ role: 'dataset_admission', source: 'postgres_json', document: player.admission, createdAt: player.admission.content.admittedAt });
    append({ role: 'model_run', source: 'postgres_json', document: player.protocol, createdAt: player.protocol.content.preparedAt });
    append({ role: 'observation_set', source: 'postgres_json', document: player.observationSet, createdAt: player.intent.content.startedAt });
    append({ role: 'model_run', source: 'postgres_json', document: player.intent, createdAt: player.intent.content.startedAt });
    append({ role: 'model_run', source: 'postgres_json', document: player.authorization, createdAt: player.authorization.content.authorizedAt });
    append({ role: 'model_run', source: 'postgres_json', document: player.run, createdAt: player.run.content.finishedAt });
    append({ role: 'dataset_admission', source: 'postgres_json', document: pick.admission, createdAt: pick.admission.content.admittedAt });
    append({ role: 'observation_set', source: 'postgres_json', document: pick.candidate.content.observationSet, createdAt: pick.candidate.content.startedAt });
    append({ role: 'model_run', source: 'postgres_json', document: pick.intent, createdAt: pick.intent.content.startedAt });
    append({ role: 'model_run', source: 'postgres_json', document: pick.authorization, createdAt: pick.authorization.content.authorizedAt });
    append({ role: 'model_run', source: 'postgres_json', document: pick.candidate, createdAt: pick.candidate.content.completedAt });
    append({ role: 'model_run', source: 'postgres_json', document: pick.consumption, createdAt: pick.consumption.content.consumedAt });
  }
  append({ role: 'valuation_bundle', source: 'postgres_json', document: bundle, createdAt: bundle.content.createdAt });
  for (const gate of gates) {
    append({ role: 'gate_3', source: 'postgres_json', document: gate.proposal, createdAt: gate.proposal.content.proposedAt });
    append({ role: 'gate_3', source: 'postgres_json', document: gate.decision, createdAt: gate.decision.content.decidedAt! });
  }
  return evidence;
}

export async function inspectPostgresPrivateValuationModelAuthority(
  transaction: AflOutcomeSqlTransaction,
  input: {
    valuationScopeKey: string;
    factualReleaseId: string;
    sourceQualificationReportId: string;
    transactionEffectiveAt: string;
    trustedAt: string;
  }
): Promise<PrivateValuationModelAuthorityInspection> {
  const candidates = await transaction.query<BundleGateCandidateRow>(
    `SELECT decision.decision_id,artifact->>'artifactId' AS valuation_bundle_id
       FROM outcome_gate_decision decision
       JOIN outcome_gate_proposal proposal ON proposal.proposal_id=decision.proposal_id
       CROSS JOIN LATERAL jsonb_array_elements(
         decision.decision_json->'content'->'affectedArtifacts'
       ) artifact
      WHERE decision.gate='gate_3_model_validity'
        AND decision.environment='non_production'
        AND decision.state='approved'
        AND proposal.scope_key=$1
        AND artifact->>'kind'='valuation_bundle'
        AND decision.effective_at<=$2::timestamptz
        AND decision.revalidate_at>$2::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM outcome_gate_decision successor
           WHERE successor.supersedes_decision_id=decision.decision_id
        )
      FOR KEY SHARE OF decision,proposal`,
    [input.valuationScopeKey, input.trustedAt]
  );
  const authenticated: Array<{ gate: AflTradeCurrentGateAuthority; chain: AflTradeAuthenticatedPrivateValuationAuthorityBundleChain }> = [];
  for (const candidate of candidates.rows) {
    const gate = await loadCurrentAflTradeGateAuthority(transaction, {
      decisionId: candidate.decision_id,
      valuationScopeKey: input.valuationScopeKey,
      trustedAt: input.trustedAt,
      expectedArtifacts: [{ kind: 'valuation_bundle', artifactId: candidate.valuation_bundle_id }],
    });
    if (gate === null) continue;
    const chain = await loadAuthenticatedAflTradePrivateValuationAuthorityBundleChain(
      transaction,
      candidate.valuation_bundle_id
    );
    if (chain === null) {
      throw new TypeError('Current Gate 3 bundle decision references unavailable custody.');
    }
    authenticated.push({ gate, chain });
  }
  if (authenticated.length === 0) return unavailableAll();
  if (authenticated.length !== 1) {
    throw new TypeError('Current governed private valuation bundle authority is ambiguous.');
  }
  const [{ gate: bundleGate, chain }] = authenticated;
  const { bundle } = chain;
  const authorities = [
    { vintage: 'at-trade', ...chain.modelAuthorities.atTrade },
    { vintage: 'current-remaining', ...chain.modelAuthorities.currentRemaining },
  ] as const;
  const factualCandidateIds = new Set(
    authorities.map(({ player }) => player.dataset.content.factualParent.factualCandidateId)
  );
  if (
    bundle.content.valuationScopeKey !== input.valuationScopeKey ||
    bundle.content.transactionEffectiveAt !== input.transactionEffectiveAt ||
    Date.parse(bundle.content.currentValuationAsOf) > Date.parse(input.trustedAt) ||
    factualCandidateIds.size !== 1 ||
    authorities.some(
      ({ player, pick }) =>
        player.dataset.content.factualParent.factualReleaseId !== input.factualReleaseId ||
        pick.candidate.content.releaseId !== input.factualReleaseId ||
        pick.admission.content.sourceQualificationReportId !==
          input.sourceQualificationReportId
    )
  ) {
    throw new TypeError('Private valuation bundle has mixed factual-release ancestry.');
  }
  const blockers: PrivateEvaluationInspectionBlocker[] = [];
  const componentGates = new Map<string, AflTradeCurrentGateAuthority | null>();
  for (const { vintage, player, pick } of authorities) {
    if (player.run.content.outcome.status !== 'succeeded') {
      blockers.push(blocker('player_model_run_not_authorized', 'model_run', `The ${vintage} governed player model run did not succeed.`));
    }
    if (!componentGates.has(player.run.runId)) {
      componentGates.set(
        player.run.runId,
        await loadCurrentAflTradeGateAuthority(transaction, {
          decisionId:
            vintage === 'at-trade'
              ? bundle.content.modelAuthorities.atTrade.player.gate3DecisionId
              : bundle.content.modelAuthorities.currentRemaining.player.gate3DecisionId,
          valuationScopeKey: input.valuationScopeKey,
          trustedAt: input.trustedAt,
          expectedArtifacts: [
            { kind: 'dataset', artifactId: player.dataset.datasetId },
            { kind: 'model_protocol', artifactId: player.protocol.protocolId },
            { kind: 'model_run', artifactId: player.run.runId },
          ],
        })
      );
    }
    if (componentGates.get(player.run.runId) === null) {
      blockers.push(blocker('player_gate3_not_approved', 'gate_3', `The exact ${vintage} governed player model run lacks current external Gate 3 approval.`));
    }
    if (!componentGates.has(pick.candidate.candidateId)) {
      componentGates.set(
        pick.candidate.candidateId,
        await loadCurrentAflTradeGateAuthority(transaction, {
          decisionId:
            vintage === 'at-trade'
              ? bundle.content.modelAuthorities.atTrade.pick.gate3DecisionId
              : bundle.content.modelAuthorities.currentRemaining.pick.gate3DecisionId,
          valuationScopeKey: input.valuationScopeKey,
          trustedAt: input.trustedAt,
          expectedArtifacts: [
            { kind: 'pick_model_candidate', artifactId: pick.candidate.candidateId },
          ],
        })
      );
    }
    if (componentGates.get(pick.candidate.candidateId) === null) {
      blockers.push(blocker('pick_gate3_not_approved', 'gate_3', `The exact ${vintage} governed pick model candidate lacks current external Gate 3 approval.`));
    }
  }
  const gates = [
    bundleGate,
    ...[...componentGates.values()].filter(
      (gate): gate is AflTradeCurrentGateAuthority => gate !== null
    ),
  ];
  return {
    evidence: modelEvidence(chain, gates),
    blockers,
    validThrough:
      blockers.length === 0
        ? gates.map(({ validThrough }) => validThrough).sort()[0]!
        : null,
    currentValuationAsOf:
      blockers.length === 0 ? bundle.content.currentValuationAsOf : null,
    hpnPavMethodId: blockers.length === 0 ? bundle.content.hpnPavMethodId : null,
    factualCandidateId:
      blockers.length === 0 ? [...factualCandidateIds][0]! : null,
  };
}
