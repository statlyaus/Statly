import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  canonicalizeAflTradeJson,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeFixtureArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import {
  createLocalGenuinePlayerDraftguruCaptureCommand,
  createLocalGenuinePlayerDraftguruAuthorityEvidenceArtifact,
  createLocalGenuinePlayerDraftguruGateRequest,
  loadExactLocalGenuinePlayerDraftguruAuthorities,
  recordLocalGenuinePlayerDraftguruAuthorities,
  type LocalGenuinePlayerDraftguruAuthorityEvidenceContent,
} from '@/server/aflTradeIntelligence/development/localGenuinePlayerDraftguruAuthority';
import { validateAflTradeExternalCaptureScope } from '@/server/aflTradeIntelligence/source/externalDraftTradeProviderIngestion';
import { evaluateAflTradeGate0A } from '@/server/aflTradeIntelligence/source/sourceContracts';

const recordedAt = '2026-09-03T00:00:00.000Z';
const evidenceContent = (
  evidenceKind: LocalGenuinePlayerDraftguruAuthorityEvidenceContent['evidenceKind']
): LocalGenuinePlayerDraftguruAuthorityEvidenceContent => ({
  schemaVersion: 'local-genuine-draftguru-authority-evidence/v1',
  issueNumber: 574,
  provider: 'draftguru',
  environment: 'non_production',
  evidenceKind,
  decision: 'approved',
  scope: {
    competition: 'AFLM',
    seasons: [2020, 2021, 2022, 2023, 2024],
    capabilities: [
      'draftguru-trade-index',
      'draftguru-trade-detail',
      'draftguru-player-trade-detail',
    ],
    use: 'private_non_production_evaluation_training_and_replay',
    publicUse: 'blocked',
  },
  statement: `Reviewed ${evidenceKind} for the bounded issue-574 run.`,
  recordedBy: 'statly-product-owner',
  recordedAt,
});
const authorityEvidence = {
  productOwnerAuthorization: createLocalGenuinePlayerDraftguruAuthorityEvidenceArtifact(
    evidenceContent('product_owner_authorization')
  ),
  boundedCapturePlan: createLocalGenuinePlayerDraftguruAuthorityEvidenceArtifact(
    evidenceContent('bounded_capture_plan')
  ),
  publicAccessReview: createLocalGenuinePlayerDraftguruAuthorityEvidenceArtifact(
    evidenceContent('public_access_review')
  ),
  fieldBoundaryReview: createLocalGenuinePlayerDraftguruAuthorityEvidenceArtifact(
    evidenceContent('field_boundary_review')
  ),
};
function issue579Content(
  kind: LocalGenuinePlayerDraftguruAuthorityEvidenceContent['evidenceKind']
) {
  return {
    ...evidenceContent(kind),
    schemaVersion: 'local-genuine-draftguru-authority-evidence/v2',
    issueNumber: 579,
    scope: { ...evidenceContent(kind).scope, seasons: [2023, 2024, 2025] },
    statement: `Fixture-only reviewed ${kind} for issue 579.`,
    recordedAt: '2026-09-06T00:00:00.000Z',
    decisionTiming: {
      termsEffectiveAt: '2026-09-06T00:00:01.000Z',
      rightsProposedAt: '2026-09-06T00:00:02.000Z',
      proposalProposedAt: '2026-09-06T00:00:03.000Z',
      decidedAt: '2026-09-06T00:00:04.000Z',
      effectiveAt: '2026-09-06T00:00:05.000Z',
      termsExpireAt: '2027-09-05T00:00:00.000Z',
      revalidateAt: '2027-09-04T00:00:00.000Z',
    },
  } as LocalGenuinePlayerDraftguruAuthorityEvidenceContent;
}
async function issue579Fixture() {
  const repository = createAflTradeFixtureArtifactRepository({ artifactClass: 'capture_metadata' });
  const documents = Object.fromEntries(
    Object.entries(authorityEvidence).map(([key, evidence]) => [
      key,
      createLocalGenuinePlayerDraftguruAuthorityEvidenceArtifact(
        issue579Content(evidence.content.evidenceKind)
      ),
    ])
  ) as typeof authorityEvidence;
  for (const document of Object.values(documents)) {
    await repository.putIfAbsent(
      document.artifact,
      new TextEncoder().encode(canonicalizeAflTradeJson(document.content))
    );
  }
  return { repository, documents };
}
const artifactRepository = createAflTradeFixtureArtifactRepository({
  artifactClass: 'capture_metadata',
});
let authorities: Awaited<ReturnType<typeof loadExactLocalGenuinePlayerDraftguruAuthorities>>;

beforeAll(async () => {
  for (const evidence of Object.values(authorityEvidence)) {
    await artifactRepository.putIfAbsent(
      evidence.artifact,
      new TextEncoder().encode(canonicalizeAflTradeJson(evidence.content))
    );
  }
  authorities = await loadExactLocalGenuinePlayerDraftguruAuthorities(
    artifactRepository,
    authorityEvidence
  );
});

describe('local genuine-player Draftguru authority', () => {
  it('preserves the retained legacy authority byte-for-byte', () => {
    expect(sha256AflTradeCanonicalJson(authorities)).toBe(
      '6020634fb6d86935bc666ee75e8d3c799fa4654e49007087c4e5f0d695b7d2a9'
    );
  });
  it('loads explicit issue-579 authority through the same retained evidence seam', async () => {
    const evidence = await issue579Fixture();
    const current = await loadExactLocalGenuinePlayerDraftguruAuthorities(
      evidence.repository,
      evidence.documents
    );
    for (const authority of current) {
      expect(authority.sourceRights.content.scope.seasonRanges).toEqual([{ from: 2023, to: 2025 }]);
      expect(authority.sourceRights.content.termsEffectiveAt).toBe('2026-09-06T00:00:01.000Z');
      expect(authority.decision.content.effectiveAt).toBe('2026-09-06T00:00:05.000Z');
      expect(authority.proposal.content.decisionKey).toContain('issue-579');
      expect(authority.sourceRights.content.operations).toMatchObject({
        public_derived_output: 'blocked',
        public_fact_display: 'blocked',
        raw_field_redistribution: 'blocked',
      });
      expect(
        evaluateAflTradeGate0A(
          { proposals: [authority.proposal], decisions: [authority.decision] },
          authority.sourceRights,
          createLocalGenuinePlayerDraftguruGateRequest(authority, 2025, {
            evaluatedAt: '2026-09-06T01:00:00.000Z',
          })
        )
      ).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
    }
    const command = createLocalGenuinePlayerDraftguruCaptureCommand(current[0], {
      season: 2025,
      discoveryFromSeason: 2023,
      sourceUrl: 'https://www.draftguru.com.au/trades',
      capturedAt: '2026-09-06T01:00:00.000Z',
      effectiveAt: '2026-09-06T01:00:00.000Z',
      maximumBytes: 1000,
    });
    expect(command.request).toMatchObject({
      anchorSeasonYear: 2025,
      discoveryFromSeasonYear: 2023,
      datasetVersion: 'live-web-2026-09-06',
    });
    expect(() => validateAflTradeExternalCaptureScope(command.request)).not.toThrow();
  });
  it.each([2022, 2026, 2024.5, NaN])(
    'rejects an unauthorized discovery start %s',
    async (discoveryFromSeason) => {
      const evidence = await issue579Fixture();
      const [authority] = await loadExactLocalGenuinePlayerDraftguruAuthorities(
        evidence.repository,
        evidence.documents
      );
      expect(() =>
        createLocalGenuinePlayerDraftguruCaptureCommand(authority, {
          season: 2025,
          discoveryFromSeason,
          sourceUrl: 'https://www.draftguru.com.au/trades',
          capturedAt: '2026-09-06T01:00:00.000Z',
          effectiveAt: '2026-09-06T01:00:00.000Z',
          maximumBytes: 1000,
        })
      ).toThrow(/discovery range/i);
    }
  );
  it.each([[2024], [2023, 2025], [2024, 2024, 2025], [2025, 2024], [2025, 2026], [2024.5, 2025]])(
    'rejects a non-exact issue-579 season scope %j',
    (...seasons) => {
      const content = issue579Content('product_owner_authorization');
      expect(() =>
        createLocalGenuinePlayerDraftguruAuthorityEvidenceArtifact({
          ...content,
          scope: { ...content.scope, seasons },
        } as LocalGenuinePlayerDraftguruAuthorityEvidenceContent)
      ).toThrow();
    }
  );
  it('rejects wrong issue numbers and backdated or unbounded decisions', () => {
    const content = issue579Content('product_owner_authorization');
    if (!('decisionTiming' in content)) throw new Error('Expected v2 fixture');
    for (const change of [
      { issueNumber: 574 },
      { recordedAt: '2026-09-06T01:00:00.000Z' },
      { decisionTiming: { ...content.decisionTiming, termsExpireAt: '2028-09-06T00:00:00.000Z' } },
      {
        decisionTiming: {
          ...content.decisionTiming,
          termsExpireAt: content.decisionTiming.effectiveAt,
        },
      },
      { decisionTiming: { ...content.decisionTiming, revalidateAt: '2026-09-06T00:00:00.000Z' } },
    ]) {
      expect(() =>
        createLocalGenuinePlayerDraftguruAuthorityEvidenceArtifact({
          ...content,
          ...change,
        } as LocalGenuinePlayerDraftguruAuthorityEvidenceContent)
      ).toThrow();
    }
  });
  it('rejects mixed versions, scopes and decision timing even when individually retained', async () => {
    const fixture = await issue579Fixture();
    const content = issue579Content('field_boundary_review');
    if (!('decisionTiming' in content)) throw new Error('Expected v2 fixture');
    for (const changed of [
      evidenceContent('field_boundary_review'),
      { ...content, scope: { ...content.scope, seasons: [2024, 2025] } },
      {
        ...content,
        decisionTiming: { ...content.decisionTiming, revalidateAt: '2027-09-03T00:00:00.000Z' },
      },
    ]) {
      const document = createLocalGenuinePlayerDraftguruAuthorityEvidenceArtifact(
        changed as LocalGenuinePlayerDraftguruAuthorityEvidenceContent
      );
      await fixture.repository.putIfAbsent(
        document.artifact,
        new TextEncoder().encode(canonicalizeAflTradeJson(document.content))
      );
      await expect(
        loadExactLocalGenuinePlayerDraftguruAuthorities(fixture.repository, {
          ...fixture.documents,
          fieldBoundaryReview: document,
        })
      ).rejects.toThrow(/exact version, scope and decision timing/i);
    }
  });
  it('rejects missing or tampered v2 bytes before using the existing ledger', async () => {
    const fixture = await issue579Fixture();
    for (const loadExact of [
      async () => null,
      async () => ({
        reference: fixture.documents.productOwnerAuthorization.artifact,
        bytes: new TextEncoder().encode('{}'),
      }),
    ]) {
      const ledger = { load: vi.fn(), appendBatch: vi.fn() };
      await expect(
        recordLocalGenuinePlayerDraftguruAuthorities(
          ledger,
          { ...fixture.repository, loadExact },
          fixture.documents
        )
      ).rejects.toThrow(/missing or differ/i);
      expect(ledger.load).not.toHaveBeenCalled();
      expect(ledger.appendBatch).not.toHaveBeenCalled();
    }
  });
  it('records the three v2 authorities through the same optimistic ledger boundary', async () => {
    const fixture = await issue579Fixture();
    const expected = await loadExactLocalGenuinePlayerDraftguruAuthorities(
      fixture.repository,
      fixture.documents
    );
    let recorded: unknown;
    const result = await recordLocalGenuinePlayerDraftguruAuthorities(
      {
        load: async () => ({ revision: 3, ledger: { proposals: [], decisions: [] } }),
        appendBatch: async (input) => {
          recorded = input;
          return {
            revision: 6,
            ledger: { proposals: [], decisions: [] },
            idempotentReplays: [false, false, false],
          };
        },
      },
      fixture.repository,
      fixture.documents
    );
    expect(recorded).toEqual({
      expectedRevision: 3,
      records: expected.map(({ sourceRights, proposal, decision }) => ({
        sourceRights,
        proposal,
        decision,
      })),
    });
    expect(result.revision).toBe(6);
  });
  it('requires retained approval and review evidence instead of generating authority', async () => {
    await expect(
      loadExactLocalGenuinePlayerDraftguruAuthorities(artifactRepository, {
        ...authorityEvidence,
        productOwnerAuthorization: {
          ...authorityEvidence.productOwnerAuthorization,
          content: evidenceContent('bounded_capture_plan'),
        },
      })
    ).rejects.toThrow(/canonical retained authority document/i);
    const [authority] = authorities;
    expect(authority?.decision.content.authorityEvidenceIds).toEqual([
      authorityEvidence.productOwnerAuthorization.artifact.artifactId,
    ]);
  });

  it('creates only bounded private non-production transaction capabilities', () => {
    expect(
      authorities.map(({ sourceRights }) =>
        sourceRights.content.acquisition.kind === 'provider_web'
          ? sourceRights.content.acquisition.capabilityId
          : null
      )
    ).toEqual(['draftguru-trade-index', 'draftguru-trade-detail', 'draftguru-player-trade-detail']);

    for (const authority of authorities) {
      expect(authority.proposal.content.decisionKey).toBe(
        `${authority.capabilityId}-non_production`
      );
      expect(authority.sourceRights.content).toMatchObject({
        provider: 'draftguru',
        scope: {
          competitions: ['AFLM'],
          seasonRanges: [{ from: 2020, to: 2024 }],
          accessMechanism: 'automated_web',
        },
        operations: {
          bounded_evaluation_capture: 'allowed',
          raw_evidence_retention: 'allowed',
          metadata_hash_retention: 'allowed',
          internal_quality_evaluation: 'allowed',
          model_training: 'allowed',
          derived_feature_creation: 'allowed',
          public_derived_output: 'blocked',
          public_fact_display: 'blocked',
          raw_field_redistribution: 'blocked',
        },
        redistribution: {
          rawFieldsPermitted: false,
          publicDerivedOutputPermitted: false,
        },
        restrictions: {
          geographic: [],
          commercial: ['internal-evaluation'],
          audience: ['internal'],
        },
        proposalOrigin: 'human_authored',
        proposedBy: 'statly-product-owner',
      });
      expect(authority.proposal.content.environment).toBe('non_production');
      expect(authority.decision.content).toMatchObject({
        environment: 'non_production',
        state: 'approved',
        accountableOwner: 'statly-product-owner',
      });
      expect(authority.sourceRights.content.fields).not.toHaveLength(0);
      expect(
        authority.sourceRights.content.fields.every(
          ({ uses }) =>
            uses.archive_fact === 'allowed' &&
            uses.derived_feature === 'allowed' &&
            uses.model_training === 'allowed' &&
            uses.public_display === 'blocked'
        )
      ).toBe(true);
    }
  });

  it('covers every emitted trade-index and trade-detail claim leaf', () => {
    const byCapability = new Map(
      authorities.map((authority) => [authority.capabilityId, authority])
    );

    expect(
      byCapability
        .get('draftguru-trade-index')!
        .sourceRights.content.fields.map(({ normalizedField }) => normalizedField)
    ).toEqual([
      'trade_detail_link.anchorSeasonYear',
      'trade_detail_link.nativeEventId',
      'trade_detail_link.sourceUrl',
    ]);
    expect(
      byCapability
        .get('draftguru-trade-detail')!
        .sourceRights.content.fields.map(({ normalizedField }) => normalizedField)
    ).toEqual([
      'directed_transfer.asset.draftType',
      'directed_transfer.asset.draftYear',
      'directed_transfer.asset.kind',
      'directed_transfer.asset.originalClub.recordedName',
      'directed_transfer.asset.player.nativeId',
      'directed_transfer.asset.player.recordedName',
      'directed_transfer.asset.recordedPickNumber',
      'directed_transfer.asset.roundNumber',
      'directed_transfer.fromClub.recordedName',
      'directed_transfer.nativeEventId',
      'directed_transfer.nativeTransferId',
      'directed_transfer.toClub.recordedName',
      'transaction.nativeEventId',
      'transaction.seasonYear',
      'transaction.title',
      'transaction.transactionType',
      'transaction_party.club.recordedName',
      'transaction_party.nativeEventId',
      'transaction_party.nativePartyId',
    ]);
    expect(
      byCapability
        .get('draftguru-player-trade-detail')!
        .sourceRights.content.fields.map(({ normalizedField }) => normalizedField)
    ).toEqual([
      'directed_transfer.asset.kind',
      'directed_transfer.asset.player.nativeId',
      'directed_transfer.asset.player.recordedName',
      'directed_transfer.fromClub.recordedName',
      'directed_transfer.nativeEventId',
      'directed_transfer.nativeTransferId',
      'directed_transfer.toClub.recordedName',
      'transaction.nativeEventId',
      'transaction.seasonYear',
      'transaction.title',
      'transaction.transactionType',
      'transaction_party.club.recordedName',
      'transaction_party.nativeEventId',
      'transaction_party.nativePartyId',
    ]);
  });

  it('produces a mechanically eligible exact capture request for every admitted season', () => {
    for (const authority of authorities) {
      const request = createLocalGenuinePlayerDraftguruGateRequest(authority, 2022, {
        evaluatedAt: '2026-09-03T00:10:00.000Z',
      });
      const result = evaluateAflTradeGate0A(
        { proposals: [authority.proposal], decisions: [authority.decision] },
        authority.sourceRights,
        request
      );

      expect(result).toMatchObject({ status: 'mechanically_eligible', blockers: [] });
      expect(request.operations).toEqual([
        'bounded_evaluation_capture',
        'raw_evidence_retention',
        'metadata_hash_retention',
        'internal_quality_evaluation',
        'model_training',
        'derived_feature_creation',
      ]);
      expect(request.fieldUses).toHaveLength(authority.sourceRights.content.fields.length * 3);
    }
  });

  it('rejects seasons outside the explicitly approved 2020-2024 window', () => {
    const [authority] = authorities;
    expect(() =>
      createLocalGenuinePlayerDraftguruGateRequest(authority!, 2025, {
        evaluatedAt: '2026-09-03T00:10:00.000Z',
      })
    ).toThrow(/2020 through 2024/i);
  });

  it('binds exact index and detail captures to their private authority', () => {
    const [index, detail, playerDetail] = authorities;
    const common = {
      capturedAt: '2026-09-03T00:10:00.000Z',
      effectiveAt: '2026-09-03T00:09:00.000Z',
      maximumBytes: 2 * 1024 * 1024,
    };
    const indexCommand = createLocalGenuinePlayerDraftguruCaptureCommand(index, {
      ...common,
      season: 2024,
      discoveryFromSeason: 2020,
      sourceUrl: 'https://www.draftguru.com.au/trades',
    });
    const detailCommand = createLocalGenuinePlayerDraftguruCaptureCommand(detail, {
      ...common,
      season: 2022,
      sourceUrl: 'https://www.draftguru.com.au/trades/2022-jason-horne-francis',
    });
    const playerDetailCommand = createLocalGenuinePlayerDraftguruCaptureCommand(playerDetail, {
      ...common,
      season: 2022,
      sourceUrl: 'https://www.draftguru.com.au/trades/2022-josh-dunkley',
    });

    expect(() => validateAflTradeExternalCaptureScope(indexCommand.request)).not.toThrow();
    expect(() => validateAflTradeExternalCaptureScope(detailCommand.request)).not.toThrow();
    expect(() => validateAflTradeExternalCaptureScope(playerDetailCommand.request)).not.toThrow();
    expect(indexCommand.gateRequest.rightsArtifactId).toBe(index.sourceRights.rightsArtifactId);
    expect(detailCommand.gateRequest.rightsArtifactId).toBe(detail.sourceRights.rightsArtifactId);
    expect(indexCommand.request.discoveryFromSeasonYear).toBe(2020);
    expect(detailCommand.request.discoveryFromSeasonYear).toBeUndefined();
  });

  it('appends the three exact authorities as one optimistic ledger batch', async () => {
    let appendInput: unknown;
    const result = await recordLocalGenuinePlayerDraftguruAuthorities(
      {
        load: async () => ({ revision: 7, ledger: { proposals: [], decisions: [] } }),
        appendBatch: async (input) => {
          appendInput = input;
          return {
            revision: 10,
            ledger: { proposals: [], decisions: [] },
            idempotentReplays: [false, false, false],
          };
        },
      },
      artifactRepository,
      authorityEvidence
    );

    expect(appendInput).toMatchObject({ expectedRevision: 7 });
    expect((appendInput as { records: unknown[] }).records).toHaveLength(3);
    expect(result.revision).toBe(10);
  });

  it('fails before reading or appending the ledger when one retained document is absent', async () => {
    const emptyRepository = createAflTradeFixtureArtifactRepository({
      artifactClass: 'capture_metadata',
    });
    const ledger = { load: vi.fn(), appendBatch: vi.fn() };

    await expect(
      recordLocalGenuinePlayerDraftguruAuthorities(ledger, emptyRepository, authorityEvidence)
    ).rejects.toThrow(/missing or differ/i);
    expect(ledger.load).not.toHaveBeenCalled();
    expect(ledger.appendBatch).not.toHaveBeenCalled();
  });
});
