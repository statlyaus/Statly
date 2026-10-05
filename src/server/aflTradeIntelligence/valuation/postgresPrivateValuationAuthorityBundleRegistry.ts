import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import {
  loadAuthenticatedAflTradeCompletedPlayerModelRunChain,
  type AflTradeAuthenticatedCompletedPlayerModelRunChain,
} from '../modeling/postgresAdmittedModelRunAuthority';
import {
  loadAuthenticatedAflTradeGovernedPickPavCandidateChain,
  type AflTradeGovernedPickPavCandidateChain,
} from '../modeling/postgresGovernedPickPavModelCandidateRegistry';
import type {
  AflOutcomeSqlClient,
  AflOutcomeSqlTransaction,
} from '../outcomes/postgresOutcomeReleaseRepository';
import {
  aflTradePrivateValuationAuthorityBundleSchema,
  type AflTradePrivateValuationAuthorityBundle,
} from './privateValuationAuthorityBundle';

interface BundleRow {
  bundle_json: unknown;
}

function exact(left: unknown, right: unknown): boolean {
  return canonicalizeAflTradeJson(left) === canonicalizeAflTradeJson(right);
}

async function requirePlayerRun(
  transaction: AflOutcomeSqlTransaction,
  player: AflTradePrivateValuationAuthorityBundle['content']['modelAuthorities']['atTrade']['player']
): Promise<AflTradeAuthenticatedCompletedPlayerModelRunChain> {
  const chain = await loadAuthenticatedAflTradeCompletedPlayerModelRunChain(
    transaction,
    player.runId
  );
  if (
    chain === null ||
    chain.run.content.outcome.status !== 'succeeded' ||
    chain.run.content.environment !== 'non_production' ||
    chain.protocol.protocolId !== player.protocolId ||
    chain.dataset.datasetId !== player.datasetId ||
    chain.admission.admissionId !== player.datasetAdmissionId ||
    chain.observationSet.observationSetId !== player.observationSetId ||
    chain.dataset.content.knowledgeCutoffAt !== player.knowledgeCutoffAt
  ) {
    throw new TypeError(
      'Private valuation bundle requires the exact succeeded non-production player model run.'
    );
  }
  return chain;
}

async function requirePickCandidate(
  transaction: AflOutcomeSqlTransaction,
  pick: AflTradePrivateValuationAuthorityBundle['content']['modelAuthorities']['atTrade']['pick'],
  hpnPavMethodId: string
): Promise<AflTradeGovernedPickPavCandidateChain> {
  const chain = await loadAuthenticatedAflTradeGovernedPickPavCandidateChain(
    transaction,
    pick.candidateId
  );
  if (
    chain === null ||
    chain.candidate.content.observationSetId !== pick.observationSetId ||
    chain.candidate.content.observationAdmissionId !== pick.observationAdmissionId ||
    chain.candidate.content.policyId !== pick.policyId ||
    chain.candidate.content.methodId !== hpnPavMethodId ||
    chain.candidate.content.observationSet.content.knowledgeCutoffAt !==
      pick.knowledgeCutoffAt ||
    chain.consumption.content.consumptionState !== 'consumed'
  ) {
    throw new TypeError(
      'Private valuation bundle requires the exact consumed governed pick model candidate.'
    );
  }
  return chain;
}

async function loadBundle(
  transaction: AflOutcomeSqlTransaction,
  bundleId: string
): Promise<AflTradePrivateValuationAuthorityBundle | null> {
  const result = await transaction.query<BundleRow>(
    `SELECT bundle_json FROM outcome_private_valuation_authority_bundle
      WHERE valuation_bundle_id=$1 FOR KEY SHARE`,
    [bundleId]
  );
  if (result.rows.length === 0) return null;
  if (result.rows.length !== 1) {
    throw new TypeError('Private valuation authority bundle is ambiguous.');
  }
  return aflTradePrivateValuationAuthorityBundleSchema.parse(result.rows[0]!.bundle_json);
}

export interface AflTradeAuthenticatedPrivateValuationAuthorityBundleChain {
  bundle: AflTradePrivateValuationAuthorityBundle;
  modelAuthorities: {
    atTrade: {
      player: AflTradeAuthenticatedCompletedPlayerModelRunChain;
      pick: AflTradeGovernedPickPavCandidateChain;
    };
    currentRemaining: {
      player: AflTradeAuthenticatedCompletedPlayerModelRunChain;
      pick: AflTradeGovernedPickPavCandidateChain;
    };
  };
}

export async function loadAuthenticatedAflTradePrivateValuationAuthorityBundleChain(
  transaction: AflOutcomeSqlTransaction,
  bundleId: string
): Promise<AflTradeAuthenticatedPrivateValuationAuthorityBundleChain | null> {
  const bundle = await loadBundle(transaction, bundleId);
  if (bundle === null) return null;
  return loadAuthenticatedAflTradePrivateValuationAuthorityBundleChainFromDocument(
    transaction,
    bundle
  );
}

export async function loadAuthenticatedAflTradePrivateValuationAuthorityBundle(
  transaction: AflOutcomeSqlTransaction,
  bundleId: string
): Promise<AflTradePrivateValuationAuthorityBundle | null> {
  return (
    await loadAuthenticatedAflTradePrivateValuationAuthorityBundleChain(
      transaction,
      bundleId
    )
  )?.bundle ?? null;
}

export class PostgresAflTradePrivateValuationAuthorityBundleRegistry {
  constructor(private readonly client: AflOutcomeSqlClient) {}

  async persist(raw: AflTradePrivateValuationAuthorityBundle): Promise<{
    bundle: AflTradePrivateValuationAuthorityBundle;
    idempotentReplay: boolean;
  }> {
    const bundle = aflTradePrivateValuationAuthorityBundleSchema.parse(structuredClone(raw));
    return this.client.transaction(
      async (transaction) => {
        await transaction.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
          `private-valuation-authority-bundle:${bundle.valuationBundleId}`,
        ]);
        await loadAuthenticatedAflTradePrivateValuationAuthorityBundleChainFromDocument(
          transaction,
          bundle
        );
        const existing = await loadBundle(transaction, bundle.valuationBundleId);
        if (existing !== null) {
          if (!exact(existing, bundle)) {
            throw new TypeError('Private valuation authority bundle replay conflicts.');
          }
          return { bundle: existing, idempotentReplay: true };
        }
        const { atTrade, currentRemaining } = bundle.content.modelAuthorities;
        await transaction.query(
          `INSERT INTO outcome_private_valuation_authority_bundle
            (valuation_bundle_id,valuation_scope_key,
             at_trade_player_run_id,at_trade_player_gate3_decision_id,
             at_trade_pick_candidate_id,at_trade_pick_gate3_decision_id,
             current_player_run_id,current_player_gate3_decision_id,
             current_pick_candidate_id,current_pick_gate3_decision_id,
             hpn_pav_method_id,transaction_effective_at,current_valuation_as_of,created_at,
             bundle_content_canonical_json,bundle_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
          [
            bundle.valuationBundleId,
            bundle.content.valuationScopeKey,
            atTrade.player.runId,
            atTrade.player.gate3DecisionId,
            atTrade.pick.candidateId,
            atTrade.pick.gate3DecisionId,
            currentRemaining.player.runId,
            currentRemaining.player.gate3DecisionId,
            currentRemaining.pick.candidateId,
            currentRemaining.pick.gate3DecisionId,
            bundle.content.hpnPavMethodId,
            bundle.content.transactionEffectiveAt,
            bundle.content.currentValuationAsOf,
            bundle.content.createdAt,
            canonicalizeAflTradeJson(bundle.content),
            canonicalizeAflTradeJson(bundle),
          ]
        );
        const readback = await loadAuthenticatedAflTradePrivateValuationAuthorityBundle(
          transaction,
          bundle.valuationBundleId
        );
        if (readback === null || !exact(readback, bundle)) {
          throw new TypeError('Private valuation authority bundle exact readback failed.');
        }
        return { bundle: readback, idempotentReplay: false };
      },
      { isolationLevel: 'serializable', accessMode: 'read_write' }
    );
  }
}

async function loadAuthenticatedAflTradePrivateValuationAuthorityBundleChainFromDocument(
  transaction: AflOutcomeSqlTransaction,
  bundle: AflTradePrivateValuationAuthorityBundle
): Promise<AflTradeAuthenticatedPrivateValuationAuthorityBundleChain> {
  const atTrade = bundle.content.modelAuthorities.atTrade;
  const currentRemaining = bundle.content.modelAuthorities.currentRemaining;
  const playerRuns = new Map<string, AflTradeAuthenticatedCompletedPlayerModelRunChain>();
  const pickCandidates = new Map<string, AflTradeGovernedPickPavCandidateChain>();
  const loadPlayer = async (component: typeof atTrade.player) => {
    const cached = playerRuns.get(component.runId);
    if (cached !== undefined) return cached;
    const loaded = await requirePlayerRun(transaction, component);
    playerRuns.set(component.runId, loaded);
    return loaded;
  };
  const loadPick = async (component: typeof atTrade.pick) => {
    const cached = pickCandidates.get(component.candidateId);
    if (cached !== undefined) return cached;
    const loaded = await requirePickCandidate(
      transaction,
      component,
      bundle.content.hpnPavMethodId
    );
    pickCandidates.set(component.candidateId, loaded);
    return loaded;
  };
  return {
    bundle,
    modelAuthorities: {
      atTrade: {
        player: await loadPlayer(atTrade.player),
        pick: await loadPick(atTrade.pick),
      },
      currentRemaining: {
        player: await loadPlayer(currentRemaining.player),
        pick: await loadPick(currentRemaining.pick),
      },
    },
  };
}
