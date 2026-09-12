import { z } from 'zod';

import {
  aflTradeArtifactRefSchema,
  doAflTradeArtifactRefsExactlyMatch,
  doesAflTradeArtifactRefMatchBytes,
  type AflTradeArtifactRef,
} from '../artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '../artifacts/immutableArtifactRepository';
import { canonicalizeAflTradeJson } from '../artifacts/contentAddress';
import { aflTradePublicIdSchema as id } from '@/types/aflTradeIntelligence/shared';
import { aflTradeComponentDrawSetSchema, type AflTradeComponentDrawSet } from './componentDrawSet';
import { aflTradeValuationCaseSchema, type AflTradeValuationCase } from './valuationCaseContracts';

const instant = z.iso.datetime({ offset: true });
const view = z.enum(['at_trade', 'realized', 'remaining', 'current']);
const seasons = z
  .array(z.number().int().min(1897).max(2200))
  .min(1)
  .max(30)
  .refine(
    (values) => values.every((year, index) => index === 0 || year === values[index - 1]! + 1),
    'Season windows must be explicit, ordered and contiguous.'
  );
const binding = z
  .object({
    assetId: id,
    view,
    runId: id,
    methodId: id,
    valueUnitId: id,
    receivingClubId: id,
    receivingSpellId: id.nullable(),
    seasons,
  })
  .strict();
const requirement = binding
  .extend({
    assetKind: z.enum(['player', 'current_pick_entitlement', 'future_pick_entitlement']),
    evidence: aflTradeArtifactRefSchema.nullable(),
  })
  .strict();
const policySchema = z
  .object({
    schemaVersion: z.literal('afl-trade-construction-compatibility-policy/v1'),
    environment: z.enum(['test_fixture', 'non_production']),
    tradeId: id,
    valuationInputBundleId: id,
    requirements: z.array(requirement).min(1).max(400),
  })
  .strict();
const evidenceSchema = binding
  .extend({
    schemaVersion: z.literal('afl-trade-construction-compatibility-evidence/v1'),
    environment: z.enum(['test_fixture', 'non_production']),
    tradeId: id,
    valuationInputBundleId: id,
    predictionCutoffAt: instant,
    knownAt: instant,
    recordedAt: instant,
    attribution: z.enum(['receiving_spell', 'across_spells']),
    pathway: z.enum(['national', 'other']).nullable(),
    access: z.enum(['open', 'restricted', 'unresolved']).nullable(),
    draftYear: z.number().int().min(1897).max(2200).nullable(),
  })
  .strict();

export type AflTradeConstructionCompatibilityIssue = Readonly<{
  assetId: string;
  view: z.infer<typeof view>;
  reason: string;
}>;

export interface AflTradeConstructionCompatibilityRequest {
  environment: 'test_fixture' | 'non_production';
  assessedAt: string;
  valuationCase: AflTradeValuationCase;
  componentDrawSet: AflTradeComponentDrawSet;
  /** Selected through the caller's current policy authority, never from a proposed forecast. */
  policyReference: AflTradeArtifactRef;
  /** Exact selected component runs, independently loaded through current run/Gate authority. */
  selectedRuns: { player: string; pick: string };
  repository: AflTradeImmutableArtifactRepository;
}

/**
 * Readback and compatibility checks only. The caller must authenticate current source, policy,
 * factual and run authority before calling. Retained bytes alone cannot establish those grants.
 * Evidence describes a forecast/measurement input, not a training observation or its future label.
 */
export async function assessAflTradeConstructionCompatibility(
  request: AflTradeConstructionCompatibilityRequest
) {
  const assessedAt = instant.parse(request.assessedAt);
  const valuationCase = aflTradeValuationCaseSchema.parse(request.valuationCase).content;
  const draws = aflTradeComponentDrawSetSchema.parse(request.componentDrawSet);
  if (
    draws.componentDrawSetId !== valuationCase.componentDrawSetId ||
    draws.content.valuationInputBundleId !== valuationCase.valuationInputBundleId
  ) {
    throw new TypeError('Compatibility draws do not match the selected case.');
  }
  const assetKinds = new Map(draws.content.assets.map((asset) => [asset.assetId, asset.assetKind]));
  const environment = policySchema.shape.environment.parse(request.environment);
  const selectedRuns = z.object({ player: id, pick: id }).strict().parse(request.selectedRuns);
  const expectedRuns = new Map([
    ['player_contribution_and_availability', selectedRuns.player],
    ['draft_pick_and_future_pick_distribution', selectedRuns.pick],
  ]);
  if (
    draws.content.valueUnitId !== valuationCase.valueUnitId ||
    draws.content.components.length !== expectedRuns.size ||
    draws.content.components.some(
      (component) => expectedRuns.get(component.role) !== component.runId
    )
  ) {
    throw new TypeError('Compatibility draws differ from selected component runs or value unit.');
  }
  if (
    request.repository.artifactClass !== 'derived_private' ||
    (environment === 'non_production' && request.repository.assurance.startsWith('fixture_'))
  ) {
    throw new TypeError('Compatibility evidence requires matching private artifact custody.');
  }
  async function load(reference: AflTradeArtifactRef) {
    const expected = aflTradeArtifactRefSchema.parse(reference);
    if (Date.parse(expected.createdAt) > Date.parse(assessedAt)) {
      throw new TypeError('Compatibility evidence postdates assessment.');
    }
    const retained = await request.repository.loadExact(expected, 2_000_000);
    if (!retained) return null;
    if (
      !doAflTradeArtifactRefsExactlyMatch(expected, retained.reference) ||
      !doesAflTradeArtifactRefMatchBytes(expected, retained.bytes, 'application/json')
    ) {
      throw new TypeError('Compatibility evidence does not match exact retained bytes.');
    }
    return JSON.parse(new TextDecoder().decode(retained.bytes)) as unknown;
  }
  const rawPolicy = await load(request.policyReference);
  if (rawPolicy === null) {
    return {
      state: 'unavailable' as const,
      reason: 'policy_missing' as const,
      qualificationGranted: false as const,
      issues: [] as AflTradeConstructionCompatibilityIssue[],
    };
  }
  const policy = policySchema.parse(rawPolicy);
  if (
    policy.environment !== environment ||
    policy.tradeId !== valuationCase.tradeId ||
    policy.valuationInputBundleId !== valuationCase.valuationInputBundleId
  ) {
    throw new TypeError('Compatibility policy does not match selected trade and bundle.');
  }
  const owners = new Map(
    valuationCase.parties.flatMap((party) =>
      party.receivedRootAssetIds.map((assetId) => [assetId, party.aflClubId] as const)
    )
  );
  const requiredKeys = new Set(
    [...owners.keys()].flatMap((assetId) =>
      valuationCase.viewContexts.map(({ view }) => `${assetId}/${view}`)
    )
  );
  const keys = policy.requirements.map((item) => `${item.assetId}/${item.view}`);
  if (
    keys.length !== requiredKeys.size ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !requiredKeys.has(key))
  ) {
    throw new TypeError(
      'Compatibility policy must cover each root asset and required view exactly once.'
    );
  }
  const issues: AflTradeConstructionCompatibilityIssue[] = [];
  for (const required of [...policy.requirements].sort((a, b) =>
    `${a.assetId}/${a.view}`.localeCompare(`${b.assetId}/${b.view}`)
  )) {
    const add = (reason: string) =>
      issues.push({ assetId: required.assetId, view: required.view, reason });
    const selectedRun = required.assetKind === 'player' ? selectedRuns.player : selectedRuns.pick;
    if (
      required.assetKind !== assetKinds.get(required.assetId) ||
      required.receivingClubId !== owners.get(required.assetId) ||
      required.valueUnitId !== valuationCase.valueUnitId ||
      required.runId !== selectedRun
    ) {
      throw new TypeError('Compatibility requirement differs from selected club, unit or run.');
    }
    if (required.evidence === null) {
      add('evidence_reference_missing');
      continue;
    }
    const rawEvidence = await load(required.evidence);
    if (rawEvidence === null) {
      add('evidence_missing');
      continue;
    }
    const evidence = evidenceSchema.parse(rawEvidence);
    if (
      evidence.environment !== environment ||
      evidence.tradeId !== policy.tradeId ||
      evidence.valuationInputBundleId !== policy.valuationInputBundleId ||
      evidence.assetId !== required.assetId ||
      evidence.view !== required.view
    ) {
      throw new TypeError('Compatibility evidence belongs to a different scope, asset or view.');
    }
    const context = valuationCase.viewContexts.find(({ view }) => view === required.view)!;
    if (Date.parse(evidence.knownAt) > Date.parse(context.knowledgeCutoffAt))
      add('knowledge_after_cutoff');
    if (
      (required.view === 'at_trade' || required.view === 'remaining') &&
      Date.parse(evidence.knownAt) > Date.parse(evidence.predictionCutoffAt)
    )
      add('knowledge_after_origin');
    if (Date.parse(evidence.predictionCutoffAt) > Date.parse(context.effectiveAt))
      add('origin_after_view');
    if (
      Date.parse(evidence.knownAt) > Date.parse(evidence.recordedAt) ||
      Date.parse(evidence.recordedAt) > Date.parse(required.evidence.createdAt)
    ) {
      throw new TypeError(
        'Compatibility evidence has invalid knowledge/recording custody chronology.'
      );
    }
    if (
      evidence.runId !== required.runId ||
      evidence.methodId !== required.methodId ||
      evidence.valueUnitId !== required.valueUnitId
    )
      add('component_policy_mismatch');
    if (canonicalizeAflTradeJson(evidence.seasons) !== canonicalizeAflTradeJson(required.seasons)) {
      add('calendar_window_mismatch');
    }
    if (
      evidence.attribution !== 'receiving_spell' ||
      (required.assetKind === 'player' && required.receivingSpellId === null) ||
      evidence.receivingSpellId !== required.receivingSpellId ||
      evidence.receivingClubId !== required.receivingClubId
    )
      add('receiving_spell_mismatch');
    if (required.assetKind !== 'player') {
      if (evidence.pathway !== 'national' || evidence.access !== 'open')
        add('pick_pathway_unsupported');
      if (evidence.draftYear === null) add('draft_year_missing');
      else if (evidence.seasons.some((season) => season <= evidence.draftYear!))
        add('pick_window_before_debut');
    }
  }
  return {
    state: issues.length ? ('incompatible' as const) : ('compatible' as const),
    qualificationGranted: false as const,
    issues,
  };
}
