import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '../artifacts/contentAddress';
import { createApprovedAflTradeFitzRoyGateRecords } from '../source/approvedFitzRoyGateRecords';
import {
  AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
  createAflTradeFitzRoyInvocation,
  parseAflTradeFitzRoyCaptureRequest,
} from '../source/fitzRoyCaptureContracts';
import type { AflTradeFitzRoyCaptureCommand } from '../source/fitzRoyCaptureRuntime';
import {
  AFL_TRADE_FITZROY_CAPABILITY_SCHEMA_VERSION,
  AFL_TRADE_FITZROY_PINNED_VERSION,
} from '../source/fitzRoyProviderCapabilities';
import {
  AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
  createDecodedFieldSchemaSha256,
  parseAflTradeFitzRoyFieldMap,
} from '../source/fitzRoyObservationContracts';
import { aflTradeSourceRightsProposalSchema } from '../source/sourceRights';

type FieldDescriptor = Readonly<{
  name: string;
  storageType: 'character' | 'integer';
  classes: string[];
  levels: null;
  timezone: null;
}>;

const integer = (name: string): FieldDescriptor => ({
  name,
  storageType: 'integer',
  classes: ['integer'],
  levels: null,
  timezone: null,
});
const character = (name: string): FieldDescriptor => ({
  name,
  storageType: 'character',
  classes: ['character'],
  levels: null,
  timezone: null,
});

export const LOCAL_AFLCA_COACHES_VOTES_FIELD_SCHEMA = [
  integer('Season'),
  integer('Round'),
  character('Home.Team'),
  character('Away.Team'),
  character('Player.Name'),
  character('Coaches.Votes'),
] satisfies readonly FieldDescriptor[];

function evidence(label: string): string {
  return `artifact:${sha256AflTradeCanonicalJson({
    boundary: 'local-aflca-coaches-votes',
    decisionDate: '2026-09-02',
    label,
  })}`;
}

function sourceFieldUse(sourceField: string) {
  const targetMetric = sourceField === 'Coaches.Votes';
  return {
    sourceField,
    normalizedField: targetMetric ? 'coaches_votes' : sourceField,
    uses: {
      archive_fact: 'allowed' as const,
      model_training: targetMetric ? ('allowed' as const) : ('blocked' as const),
      derived_feature: 'allowed' as const,
      public_display: 'blocked' as const,
    },
    attributionRequired: true,
    notes:
      'Product-owner-approved private non-production AFLCA evidence; public use and raw redistribution remain blocked.',
  };
}

function requireSeason(season: number): void {
  if (!Number.isSafeInteger(season) || season < 2021 || season > 2025) {
    throw new TypeError('The local AFLCA authority is limited to seasons 2021 through 2025.');
  }
}

export function createLocalAflTradeAflcaCoachesVotesAuthority(season: number) {
  requireSeason(season);
  const captureRequest = parseAflTradeFitzRoyCaptureRequest({
    schemaVersion: AFL_TRADE_FITZROY_CAPTURE_REQUEST_SCHEMA_VERSION,
    capabilityId: 'aflca-coaches-votes',
    competition: 'AFLM',
    authorizationSeason: season,
    parameters: { season, roundNumber: null, team: null },
  });
  const invocation = createAflTradeFitzRoyInvocation(captureRequest);
  const exactFields = LOCAL_AFLCA_COACHES_VOTES_FIELD_SCHEMA.map(({ name }) => name);
  const fields = exactFields.map(sourceFieldUse);
  const rightsContent = {
    schemaVersion: 'afl-trade-source-rights/v2' as const,
    registerId: 'aflca-coaches-votes-fitzroy-1.7.0-internal-2026-09-02',
    provider: 'afl_coaches_association',
    dataset: 'AFL Coaches Association match coaches votes',
    datasetVersion: `fitzroy-${AFL_TRADE_FITZROY_PINNED_VERSION}`,
    intendedPurpose:
      'Private non-production player-contribution target construction, model training, validation, calibration, and backtesting under the Statly product-owner risk assumption.',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: 2021, to: 2025 }],
      accessMechanism: 'automated_web' as const,
    },
    acquisition: {
      kind: 'fitzroy' as const,
      capabilitySchemaVersion: AFL_TRADE_FITZROY_CAPABILITY_SCHEMA_VERSION,
      fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
      capabilities: [
        {
          capabilityId: 'aflca-coaches-votes',
          provider: 'afl_coaches_association' as const,
          directFunction: 'fetch_coaches_votes',
        },
      ],
    },
    operations: {
      bounded_evaluation_capture: 'allowed' as const,
      raw_evidence_retention: 'allowed' as const,
      metadata_hash_retention: 'allowed' as const,
      internal_quality_evaluation: 'allowed' as const,
      model_training: 'allowed' as const,
      derived_feature_creation: 'allowed' as const,
      public_derived_output: 'blocked' as const,
      public_fact_display: 'blocked' as const,
      raw_field_redistribution: 'blocked' as const,
    },
    automatedAccess: {
      permitted: true,
      identification: 'Statly private local non-production AFLCA evaluation through fitzRoy.',
      rateLimit: { requests: 1, perSeconds: 3, burst: 1 },
      cache: { permitted: true, maximumSeconds: 86_400 },
    },
    retention: {
      rawEvidence: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis:
          'Retain exact private source evidence for reproducible evaluation while authority is current.',
      },
      hashesAndMetadata: {
        disposition: 'retained' as const,
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Retain provenance hashes and governance decisions for permanent audit.',
      },
      derivedArtifacts: {
        disposition: 'retained' as const,
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Retain private derived evidence only for reproducible evaluation and rollback.',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: false },
    attribution: {
      required: true,
      text: 'Coaches votes sourced through fitzRoy from the AFL Coaches Association.',
      placement: 'Private internal methodology and evidence review only.',
    },
    restrictions: {
      geographic: [] as string[],
      commercial: ['internal-evaluation'],
      audience: ['internal'],
    },
    fields,
    conditions: [
      {
        conditionId: 'provider-egress-control',
        description:
          'Enforce the reviewed request rate, burst, cache, and identified egress boundary.',
        appliesToOperations: ['bounded_evaluation_capture' as const],
        verificationEvidenceIds: [evidence('rate-limit')],
      },
      {
        conditionId: 'complete-round-custody',
        description:
          'Reconcile every requested round with the match universe; suppressed scrape failures remain missing evidence.',
        appliesToOperations: ['bounded_evaluation_capture' as const, 'model_training' as const],
        verificationEvidenceIds: [evidence('round-coverage-review')],
      },
      {
        conditionId: 'governed-player-resolution',
        description:
          'Resolve players through reviewed match and identity context; display-name equality alone is insufficient.',
        appliesToOperations: ['internal_quality_evaluation' as const, 'model_training' as const],
        verificationEvidenceIds: [evidence('identity-resolution-review')],
      },
    ],
    rightsEvidenceIds: [evidence('product-owner-approval'), evidence('public-access-review')],
    termsEffectiveAt: '2026-09-02T00:00:00.000Z',
    termsExpireAt: '2027-09-02T00:00:00.000Z',
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions:
        'Stop capture and delete private raw and derived bytes marked for withdrawal deletion.',
      retainableAuditMaterial:
        'Retain permitted hashes, decision history, provenance metadata, and rollback evidence.',
    },
    proposedAt: '2026-09-02T00:00:01.000Z',
    proposedBy: 'statly-product-owner',
    proposalOrigin: 'human_authored' as const,
  };
  const sourceRights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: createAflTradeContentAddress('source-rights', rightsContent),
    content: rightsContent,
  });
  const gate = createApprovedAflTradeFitzRoyGateRecords({
    sourceRights,
    environment: 'non_production',
    version: 1,
    supersedesDecisionId: null,
    decidedAt: '2026-09-02T00:00:02.000Z',
    effectiveAt: '2026-09-02T00:00:02.000Z',
    revalidateAt: '2027-09-01T00:00:00.000Z',
    accountableOwner: 'statly-product-owner',
    reviewer: {
      id: 'statly-product-owner-source-review',
      role: 'source-governance-reviewer',
      evidenceId: evidence('product-owner-source-review'),
    },
    authorityEvidenceId: evidence('product-owner-approval'),
    rateLimitEvidenceId: evidence('rate-limit'),
  });
  const capture: AflTradeFitzRoyCaptureCommand = {
    sourceRights,
    ledger: { proposals: [gate.proposal], decisions: [gate.decision] },
    gateRequest: {
      decisionKey: gate.proposal.content.decisionKey,
      environment: 'non_production',
      rightsArtifactId: sourceRights.rightsArtifactId,
      competition: 'AFLM',
      season,
      accessMechanism: 'automated_web',
      capabilityId: 'aflca-coaches-votes',
      geography: 'global',
      commercialContext: 'internal-evaluation',
      audience: 'internal',
      operations: [
        'bounded_evaluation_capture',
        'raw_evidence_retention',
        'metadata_hash_retention',
        'internal_quality_evaluation',
      ],
      fieldUses: exactFields.map((sourceField) => ({
        sourceField,
        use: 'archive_fact' as const,
      })),
      rawRetentionDays: 365,
      metadataRetentionDays: null,
      cacheSeconds: 86_400,
    },
    captureRequest,
  };
  const fieldMap = parseAflTradeFitzRoyFieldMap({
    schemaVersion: AFL_TRADE_FITZROY_FIELD_MAP_SCHEMA_VERSION,
    mapId: `aflca-coaches-votes-local-${season}-v2`,
    capabilityId: 'aflca-coaches-votes',
    fitzRoyVersion: AFL_TRADE_FITZROY_PINNED_VERSION,
    sourceSchemaSha256: createDecodedFieldSchemaSha256(LOCAL_AFLCA_COACHES_VOTES_FIELD_SCHEMA),
    exactOrderedFields: exactFields,
    observationKind: 'player_stat',
    competition: 'AFLM',
    invocationArgumentsSha256: sha256AflTradeCanonicalJson(invocation.arguments),
    validFromSeason: season,
    validThroughSeason: season,
    seasonField: { sourceField: 'Season', required: true },
    roundLabelField: { sourceField: 'Round', required: true },
    observedDateField: null,
    naturalKeyFields: ['Season', 'Round', 'Home.Team', 'Away.Team', 'Player.Name'],
    approvedAt: '2026-09-02T00:00:03.000Z',
    approvalDecisionId: `local-aflca-coaches-votes-field-map-review-${season}-v2`,
    identity: {
      nativeId: null,
      recordedName: { sourceField: 'Player.Name', required: true },
      recordedClubNativeId: null,
      recordedClubName: null,
    },
    match: {
      nativeMatchId: null,
      season: { sourceField: 'Season', required: true },
      roundLabel: { sourceField: 'Round', required: true },
      matchDate: null,
      homeClubNativeId: null,
      homeClubName: { sourceField: 'Home.Team', required: true },
      awayClubNativeId: null,
      awayClubName: { sourceField: 'Away.Team', required: true },
      status: null,
    },
    metrics: [
      {
        metricCode: 'coaches_votes',
        sourceField: 'Coaches.Votes',
        definitionVersion: 'coaches-votes/v1',
        unit: 'votes',
        zeroSemantics: 'measured_zero',
        sourceRepresentation: 'integer_text',
      },
    ],
    achievement: null,
  });
  return { capture, fieldMap, gateDecisionId: gate.decision.decisionId };
}
