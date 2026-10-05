import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import type { AflOutcomeSqlTransaction } from '../outcomes/postgresOutcomeReleaseRepository';
import type { PrivateEvaluationInspectionBlocker } from './governedPrivateTradeEvaluationContracts';
import type { PrivateEvaluationAuthorityEvidence } from './postgresPrivateEvaluationInspectionStore';
import {
  PostgresAflTradePrivateValuationAuthorityV3Registry,
  type AflTradeAuthenticatedPrivateValuationAuthorityV3Chain,
} from './postgresPrivateValuationAuthorityV3Registry';

interface BundleGateCandidateRow {
  decision_id: string;
  valuation_bundle_id: string;
}

export type PrivateValuationAuthorityV3Inspection =
  | {
      state: 'ready';
      chain: AflTradeAuthenticatedPrivateValuationAuthorityV3Chain;
      evidence: readonly PrivateEvaluationAuthorityEvidence[];
      blockers: readonly [];
      validThrough: string;
    }
  | {
      state: 'unavailable';
      chain: null;
      evidence: readonly [];
      blockers: readonly PrivateEvaluationInspectionBlocker[];
      validThrough: null;
    };

function unavailable(): PrivateValuationAuthorityV3Inspection {
  return {
    state: 'unavailable',
    chain: null,
    evidence: [],
    validThrough: null,
    blockers: [
      {
        code: 'evaluation_evidence_bundle_unavailable',
        authorityClass: 'evaluation_evidence',
        classification: 'internal_evidence',
        assetId: null,
        message:
          'No complete retained v3 evaluation-evidence bundle covers every exact trade asset.',
        evidenceRefs: [],
      },
      {
        code: 'evaluation_evidence_gate3_not_approved',
        authorityClass: 'gate_3',
        classification: 'external_authority',
        assetId: null,
        message:
          'No current external Gate 3 decision approves an exact v3 evaluation-evidence bundle.',
        evidenceRefs: [],
      },
      {
        code: 'player_model_run_not_authorized',
        authorityClass: 'model_run',
        classification: 'external_authority',
        assetId: null,
        message: 'No complete v3 authority binds exact succeeded player model runs.',
        evidenceRefs: [],
      },
      {
        code: 'pick_model_run_not_authorized',
        authorityClass: 'model_run',
        classification: 'external_authority',
        assetId: null,
        message: 'No complete v3 authority binds exact consumed pick model candidates.',
        evidenceRefs: [],
      },
      {
        code: 'player_gate3_not_approved',
        authorityClass: 'gate_3',
        classification: 'external_authority',
        assetId: null,
        message: 'No complete v3 authority retains current player-model Gate 3 decisions.',
        evidenceRefs: [],
      },
      {
        code: 'pick_gate3_not_approved',
        authorityClass: 'gate_3',
        classification: 'external_authority',
        assetId: null,
        message: 'No complete v3 authority retains current pick-model Gate 3 decisions.',
        evidenceRefs: [],
      },
      {
        code: 'valuation_bundle_not_authorized',
        authorityClass: 'valuation_bundle',
        classification: 'external_authority',
        assetId: null,
        message: 'No current external Gate 3 decision approves an authenticated v3 bundle.',
        evidenceRefs: [],
      },
    ],
  };
}

function evidenceFromChain(
  chain: AflTradeAuthenticatedPrivateValuationAuthorityV3Chain
): PrivateEvaluationAuthorityEvidence[] {
  const evidence: PrivateEvaluationAuthorityEvidence[] = [];
  const seen = new Set<string>();
  const append = (item: PrivateEvaluationAuthorityEvidence) => {
    const identity =
      item.source === 'postgres_json'
        ? `${item.role}|${canonicalizeAflTradeJson(item.document)}`
        : `${item.role}|${item.artifact.artifactId}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    evidence.push(item);
  };
  for (const root of [
    chain.factualRoots.evaluatedTrade,
    chain.factualRoots.evaluationEvidence,
  ]) {
    append({
      role: 'factual_release',
      source: 'postgres_json',
      document: root.release,
      createdAt: root.release.content.createdAt,
    });
    append({
      role: 'factual_release',
      source: 'postgres_json',
      document: root.candidate,
      createdAt: root.candidate.content.createdAt,
    });
    if (root.lineage !== null) {
      append({
        role: 'factual_release',
        source: 'postgres_json',
        document: root.lineage,
        createdAt: root.lineage.content.createdAt,
      });
    }
    append({
      role: 'source_use',
      source: 'postgres_json',
      document: root.qualification,
      createdAt: root.qualification.content.evaluatedAt,
    });
    append({
      role: 'private_evaluation',
      source: 'postgres_json',
      document: root.privateDecision,
      createdAt: root.privateDecision.content.decidedAt,
    });
  }
  append({
    role: 'evaluation_evidence',
    source: 'postgres_json',
    document: chain.evidenceBundle,
    createdAt: chain.evidenceBundle.content.createdAt,
  });
  append({
    role: 'trade_correspondence',
    source: 'retained_artifact',
    artifact: chain.bundle.content.evaluationEvidence.tradeCorrespondenceArtifact,
  });
  for (const asset of chain.evidenceBundle.content.assets) {
    const admission = chain.assetAdmissions.get(asset.assetId);
    if (admission === undefined) {
      throw new TypeError('Private valuation v3 snapshot projection lost an asset admission.');
    }
    append({
      role: asset.assetKind === 'player' ? 'player_evidence' : 'pick_evidence',
      source: 'postgres_json',
      document: admission,
      createdAt: admission.content.admittedAt,
    });
    for (const artifact of asset.dependencyArtifacts) {
      append({
        role: asset.assetKind === 'player' ? 'player_evidence' : 'pick_evidence',
        source: 'retained_artifact',
        artifact,
      });
    }
  }
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
  append({
    role: 'valuation_bundle',
    source: 'postgres_json',
    document: chain.bundle,
    createdAt: chain.bundle.content.createdAt,
  });
  for (const gate of chain.gates) {
    append({ role: 'gate_3', source: 'postgres_json', document: gate.proposal, createdAt: gate.proposal.content.proposedAt });
    append({ role: 'gate_3', source: 'postgres_json', document: gate.decision, createdAt: gate.decision.content.decidedAt! });
  }
  for (const artifact of [
    chain.bundle.content.componentCompatibilityArtifact,
    chain.bundle.content.jointSimulationProtocolArtifact,
    chain.bundle.content.gradePolicyArtifact,
  ]) {
    append({ role: 'valuation_bundle', source: 'retained_artifact', artifact });
  }
  return evidence;
}

export async function inspectPostgresPrivateValuationAuthorityV3(
  transaction: AflOutcomeSqlTransaction,
  input: {
    valuationScopeKey: string;
    trustedAt: string;
    registry: PostgresAflTradePrivateValuationAuthorityV3Registry;
  }
): Promise<PrivateValuationAuthorityV3Inspection> {
  const candidates = await transaction.query<BundleGateCandidateRow>(
    `SELECT decision.decision_id,bundle.valuation_bundle_id
       FROM outcome_private_valuation_authority_bundle_v3 bundle
       JOIN outcome_gate_decision decision
         ON decision.gate='gate_3_model_validity'
        AND decision.environment='non_production'
        AND decision.state='approved'
        AND decision.effective_at<=$2::timestamptz
        AND decision.revalidate_at>$2::timestamptz
        AND decision.decision_json->'content'->'scope'->>'scopeKey'=$1
        AND decision.decision_json->'content'->'affectedArtifacts'=jsonb_build_array(
          jsonb_build_object('kind','valuation_bundle','artifactId',bundle.valuation_bundle_id))
      WHERE bundle.valuation_scope_key=$1
        AND NOT EXISTS (
          SELECT 1 FROM outcome_gate_decision successor
           WHERE successor.supersedes_decision_id=decision.decision_id)
      FOR KEY SHARE OF bundle,decision`,
    [input.valuationScopeKey, input.trustedAt]
  );
  if (candidates.rows.length === 0) return unavailable();
  const authenticated: AflTradeAuthenticatedPrivateValuationAuthorityV3Chain[] = [];
  for (const candidate of candidates.rows) {
    const chain = await input.registry.loadAuthenticated(transaction, {
      valuationBundleId: candidate.valuation_bundle_id,
      bundleGate3DecisionId: candidate.decision_id,
      trustedAt: input.trustedAt,
    });
    if (chain === null) {
      throw new TypeError('A current v3 bundle Gate references missing immutable custody.');
    }
    authenticated.push(chain);
  }
  if (authenticated.length !== 1) {
    throw new TypeError('Current private valuation v3 authority is ambiguous.');
  }
  const chain = authenticated[0]!;
  return {
    state: 'ready',
    chain,
    evidence: evidenceFromChain(chain),
    blockers: [],
    validThrough: chain.validThrough,
  };
}
