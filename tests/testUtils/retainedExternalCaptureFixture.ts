import { DRAFTGURU_YEAR_PARSER_VERSION } from '@/server/aflTradeIntelligence/source/draftguruEventYear';
import {
  createAflTradeExternalEvidenceEnvelope,
  type AflTradeExternalEvidenceContent,
} from '@/server/aflTradeIntelligence/source/externalDraftTradeEvidenceContracts';
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
import {
  parseOfficialAflDraftSession,
  OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION,
} from '@/server/aflTradeIntelligence/source/officialAflDraftSessionAdapter';
import {
  parseDraftguruNationalYearSelections,
  parseDraftguruTradeDetail,
} from '@/server/aflTradeIntelligence/source/draftguruSourceAdapter';
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
  nullableTerms = false,
  tradeDetail = false,
  secondSession = false,
  enumerated = false,
  multiDocument = false,
  supplementalSelection = false,
  rookieExclusion = false,
  sessionWindow = false,
  miniCapacity = false,
  playerDeparture = false
) {
  function validateMiniCapacityScope() {
    if (
      miniCapacity &&
      (environment !== 'test_fixture' ||
        !enumerated ||
        multiDocument ||
        supplementalSelection ||
        rookieExclusion)
    )
      throw new Error('Capacity fixture requires explicit synthetic mini-draft scope.');
  }
  function validateFixtureScope() {
    if (rookieExclusion && (!multiDocument || environment !== 'test_fixture'))
      throw new Error('Rookie exclusion requires synthetic multi-document proof.');
    if (supplementalSelection && (!enumerated || environment !== 'test_fixture'))
      throw new Error('Supplemental synthetic selection requires enumerated test_fixture.');
    if (multiDocument && !enumerated)
      throw new Error('Multi-document proof requires enumerated fixture.');
    if (enumerated && environment !== 'test_fixture')
      throw new Error('Enumerated synthetic claims require test_fixture.');
    if (secondSession && !official) throw new Error('Second session requires official profile.');
    if (tradeDetail && official)
      throw new Error('Trade fixture cannot use the official session profile.');
  }
  validateMiniCapacityScope();
  if (
    playerDeparture &&
    (!official || environment !== 'test_fixture' || miniCapacity || enumerated || tradeDetail)
  )
    throw new Error('Departure fixture requires plain official test scope.');
  const year = miniCapacity || playerDeparture ? 2012 : 2024;
  validateFixtureScope();
  await sql.query(`INSERT INTO outcome_competition_season (competition,season_year)
    VALUES ('AFLM',${year}) ON CONFLICT DO NOTHING`);
  function sourceProfile() {
    if (playerDeparture)
      return {
        provider: 'official_afl' as const,
        capabilityId: 'official-afl-player-departure',
        sourceUrl: 'https://www.westernbulldogs.com.au/news/752883/sherman-seeks-new-home',
      };
    const provider = official ? ('official_afl' as const) : ('draftguru' as const);
    const capabilityId = official
      ? 'official-afl-completed-draft-session'
      : tradeDetail
        ? 'draftguru-trade-detail'
        : miniCapacity
          ? 'draftguru-year-page'
          : 'draftguru-national-year-page';
    const sourceUrl =
      miniCapacity && official
        ? secondSession
          ? 'https://www.afl.com.au/news/453694/official-paperwork-close-to-gillette-afl-trade-period-friday-october-26'
          : 'https://www.goldcoastfc.com.au/news/114828/final-mini-draft-explained'
        : official
          ? secondSession
            ? 'https://www.afl.com.au/news/1257674/afl-draft-night-two-tigers-hold-firm-to-pounce-on-199cm-forward-dogs-pick-twice/amp'
            : 'https://www.afl.com.au/news/1257161/new-tiger-king-richmond-snares-powerful-mid-sam-lalor-at-no1/amp'
          : tradeDetail
            ? `https://www.draftguru.com.au/trades/${year}-synthetic-pick-trade`
            : `https://www.draftguru.com.au/years/${year}`;
    return { provider, capabilityId, sourceUrl };
  }
  const { provider, capabilityId, sourceUrl } = sourceProfile();
  const at = new Date(Date.now() - 10_000).toISOString();
  const now = () => new Date().toISOString();
  const expires = new Date(Date.now() + 3600_000).toISOString();
  async function createRepositories() {
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
    return repository;
  }
  const repository = await createRepositories();
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
  const originalNumbers = Array.from({ length: selectionCount }, (_, i) =>
    !miniCapacity && enumerated && i === selectionCount - 1 ? 97 : i + 1
  );
  function draftIdentity() {
    const common = {
      draftYear: year,
      draftType: miniCapacity ? ('mini_draft' as const) : ('national' as const),
    };
    return common;
  }
  const common = draftIdentity();
  const boundary = (
    n: number,
    ordinal: number,
    side: 'first' | 'last'
  ): AflTradeExternalEvidenceContent['claim'] => ({
    ...common,
    kind: 'draft_session_boundary',
    sessionOrdinal: ordinal,
    boundary: side,
    selectionNumber: n === 71 ? 97 : n,
    player: {
      nativeId: null,
      recordedName: n === 1 ? 'Synthetic Player' : `Synthetic Player ${n - 1}`,
    },
    selectedByClub: { nativeId: null, recordedName: 'Synthetic Club' },
  });
  function buildSessionFacts() {
    const sessionFacts: AflTradeExternalEvidenceContent['claim'][] = secondSession
      ? [
          { ...common, kind: 'draft_session_date', sessionOrdinal: 2, eventDate: '2024-11-21' },
          { ...common, kind: 'draft_session_completion', sessionOrdinal: 2 },
          boundary(28, 2, 'first'),
          boundary(71, 2, 'last'),
          {
            ...common,
            kind: 'draft_completed_inventory',
            selectionNumbers: Array.from({ length: 71 }, (_, i) => (i === 70 ? 97 : i + 1)),
          },
        ]
      : [
          { ...common, kind: 'draft_session_date', sessionOrdinal: 1, eventDate: '2024-11-20' },
          { ...common, kind: 'draft_session_completion', sessionOrdinal: 1 },
          boundary(1, 1, 'first'),
          { ...common, kind: 'draft_completed_total', selectionCount: 71 },
        ];
    if (miniCapacity) {
      sessionFacts.splice(
        0,
        sessionFacts.length,
        ...(secondSession
          ? [
              {
                ...common,
                kind: 'draft_completed_membership_roster' as const,
                members: [
                  { recordedName: 'Synthetic Player', selectionNumber: 1 },
                  { recordedName: 'Synthetic Player 1', selectionNumber: 2 },
                ],
              },
              { ...common, kind: 'draft_session_completion' as const, sessionOrdinal: 1 },
              boundary(1, 1, 'first'),
              boundary(2, 1, 'last'),
            ]
          : [
              {
                ...common,
                draftType: 'mini_draft' as const,
                kind: 'draft_selection_capacity' as const,
                maximumSelections: 2,
              },
              {
                ...common,
                kind: 'draft_session_window' as const,
                sessionOrdinal: 1,
                datePrecision: {
                  precision: 'window' as const,
                  eventDate: null,
                  earliestDate: '2012-10-08',
                  latestDate: '2012-10-26',
                },
              },
            ])
      );
    }
    if (sessionWindow && official && secondSession && !miniCapacity) {
      sessionFacts[0] = {
        ...common,
        kind: 'draft_session_window',
        sessionOrdinal: 2,
        datePrecision: {
          precision: 'window',
          eventDate: null,
          earliestDate: '2024-11-21',
          latestDate: '2024-11-25',
        },
      };
    }
    function applyMultiDocumentMembership() {
      if (multiDocument && official) {
        if (secondSession) {
          const index = sessionFacts.findIndex(
            (claim) => claim.kind === 'draft_completed_inventory'
          );
          sessionFacts[index] = {
            ...common,
            kind: 'draft_completed_membership_roster',
            members: Array.from({ length: 71 }, (_, i) => ({
              recordedName: i === 0 ? 'Synthetic Player' : `Synthetic Player ${i}`,
              selectionNumber: i === 70 ? null : i + 1,
            })),
          };
        } else
          sessionFacts.push({
            ...common,
            kind: 'draft_completed_member_number',
            recordedName: 'Synthetic Player 70',
            selectionNumber: 97,
          });
      }
    }
    applyMultiDocumentMembership();
    if (supplementalSelection && official && !secondSession) {
      sessionFacts.push({
        ...common,
        kind: 'draft_selection',
        selectionNumber: 35,
        roundNumber: null,
        player: { nativeId: null, recordedName: 'Synthetic Player 34' },
        selectedByClub: { nativeId: null, recordedName: 'Synthetic Club' },
      });
    }
    function applyRookieExclusion() {
      if (rookieExclusion && official) {
        if (secondSession) {
          const roster = sessionFacts.find(
            (claim) => claim.kind === 'draft_completed_membership_roster'
          );
          if (!roster || roster.kind !== 'draft_completed_membership_roster')
            throw new Error('Roster required.');
          roster.members.push({ recordedName: 'Elevated Rookie', selectionNumber: 85 });
        } else
          sessionFacts.push({
            ...common,
            kind: 'draft_completed_member_exclusion',
            draftType: 'national',
            recordedName: 'Elevated Rookie',
            reason: 'rookie_elevation',
          });
      }
    }
    applyRookieExclusion();
    return sessionFacts;
  }
  const sessionFacts = buildSessionFacts();
  function buildFieldManifest() {
    if (playerDeparture)
      return ['departureYear', 'recordedPlayer', 'recordedClub', 'reason']
        .map((f) => 'player_departure_reference.' + f)
        .sort();
    const fields =
      official && enumerated
        ? [
            ...new Set(
              sessionFacts.flatMap((claim) =>
                Object.keys(claim)
                  .filter((key) => key !== 'kind')
                  .flatMap((key) => {
                    const value = (claim as unknown as Record<string, unknown>)[key];
                    if (
                      Array.isArray(value) &&
                      value.some((item) => item && typeof item === 'object')
                    ) {
                      return value.flatMap((item) =>
                        Object.keys(item).map((child) => `${claim.kind}.${key}.${child}`)
                      );
                    }
                    return value && typeof value === 'object' && !Array.isArray(value)
                      ? Object.keys(value).map((child) => `${claim.kind}.${key}.${child}`)
                      : [`${claim.kind}.${key}`];
                  })
              )
            ),
          ].sort()
        : official
          ? [
              'draftType',
              'draftYear',
              'eventDate',
              'officialName',
              'selectionNumbers',
              'sessionOrdinal',
            ]
              .map((f) => 'draft_session.' + f)
              .sort()
          : tradeDetail
            ? [
                'transaction.nativeEventId',
                'transaction.seasonYear',
                'transaction.occurredOn',
                'transaction.transactionType',
                'transaction.title',
                'transaction_party.nativeEventId',
                'transaction_party.nativePartyId',
                'transaction_party.club.nativeId',
                'transaction_party.club.recordedName',
                'directed_transfer.nativeEventId',
                'directed_transfer.nativeTransferId',
                'directed_transfer.fromClub.nativeId',
                'directed_transfer.fromClub.recordedName',
                'directed_transfer.toClub.nativeId',
                'directed_transfer.toClub.recordedName',
                'directed_transfer.asset.kind',
                'directed_transfer.asset.draftYear',
                'directed_transfer.asset.draftType',
                'directed_transfer.asset.recordedPickNumber',
                'directed_transfer.asset.recordedLabel',
              ].sort()
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
    return fields;
  }
  const fields = buildFieldManifest();
  function buildSourceRights() {
    const content = {
      schemaVersion: 'afl-trade-source-rights/v2',
      registerId: 'synthetic-retained-' + provider + '-' + at,
      provider,
      dataset: miniCapacity
        ? 'Synthetic retained mini-draft capacity selections'
        : 'Synthetic retained national selections',
      datasetVersion: 'synthetic/v1',
      intendedPurpose: 'Synthetic private source closure regression',
      scope: {
        competitions: ['AFLM'],
        seasonRanges: [{ from: year, to: year }],
        accessMechanism: 'automated_web',
      },
      acquisition: {
        kind: 'provider_web',
        clientName: 'Synthetic',
        clientVersion: playerDeparture
          ? 'official-afl-player-departure/v1'
          : official
            ? OFFICIAL_AFL_DRAFT_SESSION_PARSER_VERSION
            : miniCapacity && !official && !tradeDetail
              ? DRAFTGURU_YEAR_PARSER_VERSION
              : 'synthetic-national/v1',
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
    return { content, rights };
  }
  const { content, rights } = buildSourceRights();
  const decisionKey = 'synthetic-retained-' + provider + '-' + at;
  const decisionScope = {
    scopeKey: decisionKey,
    description: 'Synthetic retained capture',
    dimensions: [
      { name: 'source_rights_artifact', values: [rights.rightsArtifactId] },
      { name: 'competition', values: ['AFLM'] },
      { name: 'season', values: [String(year)] },
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
  function buildCaptureRequest() {
    const request = {
      environment,
      provider,
      competition: 'AFLM',
      anchorSeasonYear: year,
      discoveryFromSeasonYear: null,
      draftPathway:
        playerDeparture || tradeDetail || (miniCapacity && !official)
          ? null
          : miniCapacity
            ? ('mini_draft' as const)
            : ('national' as const),
      dataset: content.dataset,
      datasetVersion: content.datasetVersion,
      accessMechanism: 'automated_web',
      capabilityId: content.acquisition.capabilityId,
      sourceUrl,
      capturedAt: at,
      effectiveAt:
        miniCapacity || playerDeparture ? '2012-10-26T00:00:00.000Z' : '2024-11-21T00:00:00.000Z',
      parserVersion: content.acquisition.clientVersion,
      fieldManifestSha256: sha(rights.content.fields),
      maximumBytes: 2097152,
    };
    return request;
  }
  const request = buildCaptureRequest();
  const raw = repository('raw_source');
  function buildSourceBytes() {
    if (playerDeparture)
      return new TextEncoder().encode('Synthetic explicit player departure from club in2012.');
    const officialHtml = `<div class="amp-article__date">Nov ${secondSession ? 21 : 20}, 2024</div><div class="article-body"><p>${secondSession ? 'Thursday night, night two finished with a total of 71 selections.' : "Selections completed in Wednesday night's opening round; the last pick was No.27."}</p><h4>2024 Telstra AFL Draft – First Round</h4><p>${Array.from({ length: 27 }, (_, i) => `${i + 1}. Synthetic player (Synthetic club)`).join('<br>')}</p>${secondSession ? '<h4>Second Round</h4><p>' + Array.from({ length: 44 }, (_, i) => `${i + 28}. Synthetic player (Synthetic club)`).join('<br>') + '</p>' : ''}</div>`;
    const tradeHtml = `<h2 class="heading">${year} Synthetic Club and Synthetic Other Club Trade for Draft Picks</h2>
<table class="individual-trade">
<tr class="club-header"><td>Synthetic Other Club</td></tr>
<tr class="club-subheader"><td colspan="5">What Other Gave</td><td colspan="5">What Other Got</td></tr>
<tr class="movement"><td class="pick-name actual-asset">Pick ${originalNumbers.at(-1)}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr class="club-header"><td>Synthetic Club</td></tr>
<tr class="club-subheader"><td colspan="5">What Club Gave</td><td colspan="5">What Club Got</td></tr>
<tr class="movement"><td></td><td></td><td></td><td></td><td></td><td class="pick-name actual-asset">Pick ${originalNumbers.at(-1)}</td><td></td><td></td><td></td><td></td></tr>
</table>`;
    const bytes = new TextEncoder().encode(
      miniCapacity && !official && !tradeDetail
        ? JSON.stringify(
            Array.from({ length: selectionCount }, (_, index) => ({
              ...common,
              kind: 'draft_selection',
              selectionNumber: index + 1,
              roundNumber: null,
              player: {
                nativeId: `synthetic-player${index ? '-' + index : ''}`,
                recordedName: `Synthetic Player${index ? ' ' + index : ''}`,
              },
              selectedByClub: { nativeId: 'synthetic-club', recordedName: 'Synthetic Club' },
            }))
          )
        : official
          ? enumerated
            ? JSON.stringify(sessionFacts)
            : officialHtml
          : tradeDetail
            ? tradeHtml
            : `<table class="big-pick-movements"><tbody>${Array.from({ length: selectionCount }, (_, i) => (supplementalSelection && i === 34 ? '' : `<tr><td class="draft">National</td><td class="number">${originalNumbers[i]}</td><td class="player"><a href="/players/synthetic-player${i === 0 ? '' : '-' + i}">Synthetic Player${i === 0 ? '' : ' ' + i}</a></td><td class="club"><a href="/clubs/synthetic-club">Synthetic Club</a></td></tr>`)).join('')}</tbody></table>`
    );
    return bytes;
  }
  const bytes = buildSourceBytes();
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
  async function captureAndValidate() {
    const result = await ingestAuthorizedAflTradeExternalPage(
      {
        request,
        gateRequest: {
          decisionKey,
          environment,
          rightsArtifactId: rights.rightsArtifactId,
          evaluatedAt: request.capturedAt,
          competition: 'AFLM',
          season: year,
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
            playerDeparture
              ? {
                  evidence: [
                    createAflTradeExternalEvidenceEnvelope({
                      schemaVersion: 'afl-trade-external-evidence/v1',
                      provider: 'official_afl',
                      capture,
                      sourceRow: { ordinal: 1, sourceKey: 'synthetic-departure' },
                      claim: {
                        kind: 'player_departure_reference',
                        departureYear: 2012,
                        recordedPlayer: 'Synthetic Player',
                        recordedClub: 'Western Bulldogs',
                        reason: 'contract_release',
                      },
                      publicationEligible: false,
                    }),
                  ],
                  issues: [],
                }
              : miniCapacity && !tradeDetail
                ? {
                    evidence: (JSON.parse(html) as AflTradeExternalEvidenceContent['claim'][]).map(
                      (claim, index) =>
                        createAflTradeExternalEvidenceEnvelope({
                          schemaVersion: 'afl-trade-external-evidence/v1',
                          provider,
                          capture,
                          sourceRow: {
                            ordinal: index + 1,
                            sourceKey: `synthetic-mini-capacity:${index}`,
                          },
                          claim,
                          publicationEligible: false,
                        })
                    ),
                    issues: [],
                  }
                : official
                  ? enumerated
                    ? {
                        evidence: (
                          JSON.parse(html) as AflTradeExternalEvidenceContent['claim'][]
                        ).map((claim, index) =>
                          createAflTradeExternalEvidenceEnvelope({
                            schemaVersion: 'afl-trade-external-evidence/v1',
                            provider: 'official_afl',
                            capture,
                            sourceRow: {
                              ordinal: index + 1,
                              sourceKey: `synthetic-enumerated:${index}`,
                            },
                            claim,
                            publicationEligible: false,
                          })
                        ),
                        issues: [],
                      }
                    : parseOfficialAflDraftSession(html, { capture })
                  : tradeDetail
                    ? (() => {
                        const result = parseDraftguruTradeDetail(html, {
                          capture,
                          draftYear: year,
                          effectiveAt: request.effectiveAt,
                        });
                        return !miniCapacity
                          ? result
                          : {
                              ...result,
                              evidence: result.evidence.map((e) =>
                                createAflTradeExternalEvidenceEnvelope({
                                  ...e.content,
                                  claim:
                                    e.content.claim.kind === 'directed_transfer' &&
                                    e.content.claim.asset.kind === 'current_pick'
                                      ? {
                                          ...e.content.claim,
                                          asset: {
                                            ...e.content.claim.asset,
                                            draftType: 'mini_draft',
                                          },
                                        }
                                      : e.content.claim,
                                })
                              ),
                            };
                      })()
                    : parseDraftguruNationalYearSelections(html, { capture, draftYear: year }),
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
    return result as typeof result & { result: typeof result.result };
  }
  const result = await captureAndValidate();
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
