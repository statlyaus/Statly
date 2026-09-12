import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAflTradeNonProductionArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  canonicalizeAflTradeJson as canonical,
  createAflTradeContentAddress as address,
  sha256AflTradeCanonicalJson as sha,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeFixtureArtifactRepository,
  verifyAflTradeArtifactReadback,
} from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import {
  aflTradeGateDecisionProposalSchema,
  aflTradeGateDecisionRecordSchema,
} from '@/server/aflTradeIntelligence/governance/gateDecisionTypes';
import { createPostgresAflTradeGateDecisionLedgerRepository } from '@/server/aflTradeIntelligence/governance/postgresGateDecisionLedgerRepository';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import { parseOfficialAflDraftSession } from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import { parseDraftguruNationalYearSelections } from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
import type { PersistAflTradeExternalCaptureInput } from '@/server/aflTradeIntelligence/source/externalDraftTradeIngestion';
import { ingestAuthorizedAflTradeExternalPage } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { PostgresAflTradeExternalCaptureRegistry } from '@/server/aflTradeIntelligence/source/postgresExternalCaptureRegistry';
import { PostgresAflTradeExternalEvidenceRepository } from '@/server/aflTradeIntelligence/source/postgresExternalEvidenceRepository';
import { aflTradeSourceRightsProposalSchema } from '@/server/aflTradeIntelligence/source/sourceRights';

/** Synthetic network/admission only; actual Gate/custody/capture/staging owners and SQL guards. */
export async function createRetainedExternalCaptureFixture(
  sql: AflOutcomeSqlClient,
  official = false,
  environment: 'test_fixture' | 'non_production' = 'test_fixture',
  selectionCount = 1,
  nullableTerms = false
) {
  await sql.query(`INSERT INTO outcome_competition_season (competition,season_year)
    VALUES ('AFLM',2024) ON CONFLICT DO NOTHING`);
  const provider = official ? ('official_afl' as const) : ('draftguru' as const);
  const capabilityId = official
    ? 'official-afl-completed-draft-session'
    : 'draftguru-national-year-page';
  const sourceUrl = official
    ? 'https://www.afl.com.au/news/1257161/new-tiger-king-richmond-snares-powerful-mid-sam-lalor-at-no1/amp'
    : 'https://www.draftguru.com.au/years/2024';
  const at = new Date(Date.now() - 10_000).toISOString();
  const now = () => new Date().toISOString();
  const expires = new Date(Date.now() + 3600_000).toISOString();
  const localRoot =
    environment === 'non_production'
      ? await mkdtemp(join(tmpdir(), 'statly-retained-synthetic-custody-'))
      : null;
  const repository = (artifactClass: 'capture_metadata' | 'raw_source') =>
    localRoot
      ? createLocalAflTradeNonProductionArtifactRepository({
          rootDirectory: localRoot,
          repositoryId: artifactClass,
          artifactClass,
          maximumObjectBytes: 2097152,
        })
      : createAflTradeFixtureArtifactRepository({ artifactClass });
  const metadata = repository('capture_metadata');
  const scopeDocument = { syntheticSourceAndReviewerEvidence: true, provider, createdAt: at };
  const scope = createAflTradeCanonicalJsonArtifactRef(scopeDocument, at);
  await metadata.putIfAbsent(scope, new TextEncoder().encode(canonical(scopeDocument)));
  const readback = await verifyAflTradeArtifactReadback(metadata, scope, at, 2097152);
  await sql.query(
    `INSERT INTO outcome_artifact_custody
    (artifact_id,content_sha256,storage_uri,media_type,byte_length,artifact_class,environment,created_at,verified_at,custody_json)
    VALUES($1,$2,$3,$4,$5,'capture_metadata',$9,$6,$7,$8::jsonb)`,
    [
      scope.artifactId,
      scope.contentSha256,
      scope.storageUri,
      scope.mediaType,
      scope.byteLength,
      at,
      readback.content.verifiedAt,
      canonical(readback),
      environment,
    ]
  );
  const operations = [
    'bounded_evaluation_capture',
    'raw_evidence_retention',
    'metadata_hash_retention',
    'internal_quality_evaluation',
  ] as const;
  const fields = official
    ? ['draftType', 'draftYear', 'eventDate', 'officialName', 'selectionNumbers', 'sessionOrdinal']
        .map((f) => 'draft_session.' + f)
        .sort()
    : [
        'draftYear',
        'draftType',
        'selectionNumber',
        'player.nativeId',
        'player.recordedName',
        'selectedByClub.nativeId',
        'selectedByClub.recordedName',
      ]
        .map((f) => 'draft_selection.' + f)
        .sort();
  const content = {
    schemaVersion: 'afl-trade-source-rights/v2',
    registerId: 'synthetic-retained-' + provider + '-' + at,
    provider,
    dataset: 'Synthetic retained national selections',
    datasetVersion: 'synthetic/v1',
    intendedPurpose: 'Synthetic private source closure regression',
    scope: {
      competitions: ['AFLM'],
      seasonRanges: [{ from: 2024, to: 2024 }],
      accessMechanism: 'automated_web',
    },
    acquisition: {
      kind: 'provider_web',
      clientName: 'Synthetic',
      clientVersion: 'synthetic-national/v1',
      capabilityId,
    },
    operations: {
      bounded_evaluation_capture: 'allowed',
      raw_evidence_retention: 'allowed',
      metadata_hash_retention: 'allowed',
      internal_quality_evaluation: 'allowed',
      model_training: 'blocked',
      derived_feature_creation: 'blocked',
      public_derived_output: 'blocked',
      public_fact_display: 'blocked',
      raw_field_redistribution: 'blocked',
    },
    automatedAccess: {
      permitted: true,
      identification: 'Synthetic',
      rateLimit: { requests: 1, perSeconds: 5, burst: 1 },
      cache: { permitted: true, maximumSeconds: 3600 },
    },
    retention: {
      rawEvidence: {
        disposition: 'retained',
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Synthetic',
      },
      hashesAndMetadata: {
        disposition: 'retained',
        maximumDays: null,
        deleteOnWithdrawal: false,
        basis: 'Synthetic',
      },
      derivedArtifacts: {
        disposition: 'retained',
        maximumDays: 365,
        deleteOnWithdrawal: true,
        basis: 'Synthetic',
      },
    },
    redistribution: { rawFieldsPermitted: false, publicDerivedOutputPermitted: false },
    attribution: { required: true, text: 'Synthetic', placement: 'Synthetic' },
    restrictions: { geographic: [], commercial: ['internal-evaluation'], audience: ['internal'] },
    fields: fields.map((f) => ({
      sourceField: f,
      normalizedField: f,
      uses: {
        archive_fact: 'allowed',
        model_training: 'blocked',
        derived_feature: 'blocked',
        public_display: 'blocked',
      },
      attributionRequired: true,
      notes: 'Synthetic',
    })),
    conditions: [
      {
        conditionId: 'provider-egress-control',
        description: 'Synthetic admission/network',
        appliesToOperations: ['bounded_evaluation_capture'],
        verificationEvidenceIds: [scope.artifactId],
      },
    ],
    rightsEvidenceIds: [scope.artifactId],
    termsEffectiveAt: nullableTerms ? null : at,
    termsExpireAt: nullableTerms ? null : expires,
    withdrawalDuties: {
      stopCollection: true,
      stopNewDerivedWork: true,
      reassessPublishedOutputs: true,
      deletionInstructions: 'Synthetic',
      retainableAuditMaterial: 'Synthetic',
    },
    proposedAt: at,
    proposedBy: 'synthetic-owner',
    proposalOrigin: 'agent_assisted',
  };
  const rights = aflTradeSourceRightsProposalSchema.parse({
    rightsArtifactId: address('source-rights', content),
    content,
  });
  const decisionKey = 'synthetic-retained-' + provider + '-' + at;
  const decisionScope = {
    scopeKey: decisionKey,
    description: 'Synthetic retained capture',
    dimensions: [
      { name: 'source_rights_artifact', values: [rights.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: ['2024'] },
      { name: 'access_mechanism', values: ['automated_web'] },
      { name: 'geography', values: ['global'] },
      { name: 'commercial_context', values: ['internal-evaluation'] },
      { name: 'audience', values: ['internal'] },
      { name: 'operation', values: [...operations] },
    ],
    exclusions: ['Synthetic only'],
  };
  const pc = {
    schemaVersion: 'afl-trade-gate-proposal/v1',
    gate: 'gate_0a_permission_to_evaluate',
    decisionKey,
    version: 1,
    environment,
    scope: decisionScope,
    proposal: 'Synthetic retained capture',
    alternativesConsidered: ['Skip synthetic test'],
    accountableOwner: 'synthetic-owner',
    reviewRequirement: 'accountable_owner_only',
    requiredReviewerRoles: [],
    conditions: [
      {
        conditionId: 'provider-egress-control',
        description: 'Synthetic network',
        required: true,
        verificationEvidenceIds: [scope.artifactId],
      },
    ],
    evidenceIds: [scope.artifactId],
    affectedArtifacts: [{ kind: 'source_rights', artifactId: rights.rightsArtifactId }],
    proposedAt: at,
    proposedBy: 'synthetic-owner',
    proposalOrigin: 'agent_assisted',
  };
  const proposal = aflTradeGateDecisionProposalSchema.parse({
    proposalId: address('gate-proposal', pc),
    content: pc,
  });
  const dc = {
    schemaVersion: 'afl-trade-gate-decision/v1',
    proposalId: proposal.proposalId,
    gate: pc.gate,
    decisionKey,
    version: 1,
    environment,
    scope: decisionScope,
    state: 'approved',
    // Synthetic upstream record, including when testing the nonproduction owner path.
    authorityKind: environment === 'test_fixture' ? 'fixture' : 'external_human_record',
    accountableOwner: 'synthetic-owner',
    decidedBy: 'synthetic-owner',
    reviewers: [],
    authorityEvidenceIds: [scope.artifactId],
    conditionResults: [
      {
        conditionId: 'provider-egress-control',
        status: 'satisfied',
        evidenceIds: [scope.artifactId],
        explanation: 'Synthetic network admission',
      },
    ],
    rationale: 'Synthetic only',
    limitations: ['Synthetic only'],
    decidedAt: at,
    effectiveAt: at,
    revalidateAt: expires,
    supersedesDecisionId: null,
    affectedArtifacts: pc.affectedArtifacts,
    withdrawalActions: [],
  };
  const decision = aflTradeGateDecisionRecordSchema.parse({
    decisionId: address('gate-decision', dc),
    content: dc,
  });
  const ledger = createPostgresAflTradeGateDecisionLedgerRepository(sql);
  await ledger.append({
    expectedRevision: (await ledger.load()).revision,
    sourceRights: rights,
    proposal,
    decision,
  });
  const request = {
    environment,
    provider,
    competition: 'AFLM',
    anchorSeasonYear: 2024,
    discoveryFromSeasonYear: null,
    draftPathway: 'national' as const,
    dataset: content.dataset,
    datasetVersion: content.datasetVersion,
    accessMechanism: 'automated_web',
    capabilityId: content.acquisition.capabilityId,
    sourceUrl,
    capturedAt: at,
    effectiveAt: '2024-11-21T00:00:00.000Z',
    parserVersion: content.acquisition.clientVersion,
    fieldManifestSha256: sha(rights.content.fields),
    maximumBytes: 2097152,
  };
  const raw = repository('raw_source');
  const officialHtml = `<div class="amp-article__date">Nov 20, 2024</div><div class="article-body"><p>Selections completed in Wednesday night's opening round; the last pick was No.27.</p><h4>2024 Telstra AFL Draft – First Round</h4><p>${Array.from({ length: 27 }, (_, i) => `${i + 1}. Synthetic player (Synthetic club)`).join('<br>')}</p></div>`;
  const bytes = new TextEncoder().encode(
    official
      ? officialHtml
      : `<table class="big-pick-movements"><tbody>${Array.from({ length: selectionCount }, (_, i) => `<tr><td class="draft">National</td><td class="number">${i + 1}</td><td class="player"><a href="/players/synthetic-player${i === 0 ? '' : '-' + i}">Synthetic Player${i === 0 ? '' : ' ' + i}</a></td><td class="club"><a href="/clubs/synthetic-club">Synthetic Club</a></td></tr>`).join('')}</tbody></table>`
  );
  const sourceArtifact = createAflTradeByteArtifactRef(bytes, 'text/html', request.capturedAt);
  const captures = new PostgresAflTradeExternalCaptureRegistry(sql);
  const captured: PersistAflTradeExternalCaptureInput[] = [];
  const policy = {
    upstreamRate: { requests: 1, perSeconds: 5, burst: 1 },
    cacheSeconds: 3600,
    maximumLeaseMs: 120000,
    egressPolicyEvidenceId: scope.artifactId,
    rawRetentionDays: 365,
  };
  const result = await ingestAuthorizedAflTradeExternalPage(
    {
      request,
      gateRequest: {
        decisionKey,
        environment,
        rightsArtifactId: rights.rightsArtifactId,
        evaluatedAt: request.capturedAt,
        competition: 'AFLM',
        season: 2024,
        accessMechanism: 'automated_web',
        capabilityId: null,
        geography: 'global',
        commercialContext: 'internal-evaluation',
        audience: 'internal',
        operations: [...operations],
        fieldUses: fields.map((sourceField) => ({ sourceField, use: 'archive_fact' as const })),
        rawRetentionDays: 365,
        metadataRetentionDays: null,
        cacheSeconds: 3600,
      },
    },
    {
      clock: { now },
      resolveAuthorization: (id) => ledger.resolveAuthorization(id),
      policyFor: () => policy,
      admission: {
        acquire: async (input) => ({
          status: 'admitted',
          lease: {
            provider,
            capabilityId: request.capabilityId,
            requestSha256: input.requestSha256,
            token: 'synthetic-token',
            providerKey: 'synthetic-provider',
            requestKey: 'synthetic-request',
            expiresAtMs: Date.now() + 120000,
            providerCooldownMs: 5000,
            successRequestCooldownMs: 3600000,
            egressPolicyEvidenceId: scope.artifactId,
          },
        }),
        complete: async () => {},
      },
      ingestion: {
        rawArtifacts: raw,
        captureRegistry: {
          loadValidators: (input) => captures.loadValidators(input),
          persistNotModified: (input) => captures.persistNotModified(input),
          persistCapture: async (input) => {
            captured.push(input);
            return captures.persistCapture(input);
          },
        },
        staging: new PostgresAflTradeExternalEvidenceRepository(sql),
        capturePage: async () => ({
          status: 'captured',
          sourceUrl: request.sourceUrl,
          bytes,
          contentSha256: sourceArtifact.contentSha256,
          mediaType: 'text/html',
          eTag: null,
          lastModified: null,
        }),
        parsePage: ({ html, capture }) =>
          official
            ? parseOfficialAflDraftSession(html, { capture })
            : parseDraftguruNationalYearSelections(html, { capture, draftYear: 2024 }),
      },
    }
  );
  if (
    result.status !== 'completed' ||
    result.result.status !== 'staged' ||
    result.result.issueCount !== 0 ||
    captured.length !== 1
  )
    throw new Error('Synthetic retained capture did not stage exactly.');
  return {
    target: {
      captureId: result.result.captureId,
      evidenceBatchId: result.result.batchId,
      executionReceiptId: captured[0]!.executionReceipt.receiptId,
      rightsArtifactId: rights.rightsArtifactId,
      gateDecisionId: decision.decisionId,
      sourceArtifact: captured[0]!.artifact,
      request,
    },
    scopeEvidence: [scope],
    rights,
    proposal,
    decision,
    ledger,
    raw,
    metadata,
  };
}
