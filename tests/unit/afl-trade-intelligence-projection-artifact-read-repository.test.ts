// @vitest-environment node

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_PROJECTION_ARTIFACT_READ_LIMITATION,
  AFL_TRADE_PROJECTION_ARTIFACT_READ_CLOCK_POLICY,
  AFL_TRADE_PROJECTION_ARTIFACT_READ_FAILED_CANDIDATE_BINDING,
  AFL_TRADE_PROJECTION_ARTIFACT_READ_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
  AFL_TRADE_PROJECTION_ARTIFACT_READ_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_ARTIFACT_READ_SELECTION,
  AflTradeProjectionArtifactMountError,
  AflTradeProjectionArtifactReadError,
  createAflTradeProjectionArtifactReadRepository,
  isAflTradeProjectionArtifactMountError,
  isAflTradeProjectionArtifactReadError,
  type AflTradeProjectionArtifactMountErrorCode,
  type AflTradeProjectionArtifactReadErrorCode,
  type AflTradeProjectionArtifactReadRepository,
  type AflTradeProjectionFailedCandidateProvider,
} from '@/server/aflTradeIntelligence/publication/projectionArtifactReadRepository';
import { createAflTradeProjectionManifestMaterialization } from '@/server/aflTradeIntelligence/publication/projectionManifestMaterialization';
import type { AflTradePublicationReadSelection } from '@/server/aflTradeIntelligence/publication/publicationState';
import {
  AFL_TRADE_METHODOLOGY_HREF,
  AFL_TRADE_VALUATION_VIEWS,
} from '@/types/aflTradeIntelligence';

import {
  CHECKED_AT,
  createAflTradeProjectionManifestFixture,
  createAflTradeProjectionManifestMaterializationInput,
  type AflTradeProjectionManifestFixture,
} from '../fixtures/aflTradeProjectionManifestFixture';

function isoAfter(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function otherId(prefix: 'projection' | 'publication' | 'valuation-bundle', label: string): string {
  return createAflTradeContentAddress(prefix, { fixture: 'projection-read-repository', label });
}

async function expectMountError(
  action: () => Promise<unknown>,
  code: AflTradeProjectionArtifactMountErrorCode
): Promise<AflTradeProjectionArtifactMountError> {
  try {
    await action();
  } catch (error) {
    expect(isAflTradeProjectionArtifactMountError(error)).toBe(true);
    expect(error).toBeInstanceOf(AflTradeProjectionArtifactMountError);
    expect((error as AflTradeProjectionArtifactMountError).code).toBe(code);
    return error as AflTradeProjectionArtifactMountError;
  }
  throw new Error(`Expected projection artifact mount error ${code}.`);
}

async function expectReadError(
  action: () => Promise<unknown>,
  code: AflTradeProjectionArtifactReadErrorCode
): Promise<AflTradeProjectionArtifactReadError> {
  try {
    await action();
  } catch (error) {
    expect(isAflTradeProjectionArtifactReadError(error)).toBe(true);
    expect(error).toBeInstanceOf(AflTradeProjectionArtifactReadError);
    expect((error as AflTradeProjectionArtifactReadError).code).toBe(code);
    return error as AflTradeProjectionArtifactReadError;
  }
  throw new Error(`Expected projection artifact read error ${code}.`);
}

describe('AFL trade projection artifact read repository', () => {
  let fixture: AflTradeProjectionManifestFixture;
  let release: ReturnType<typeof createAflTradeProjectionManifestMaterializationInput> & {
    output: ReturnType<typeof createAflTradeProjectionManifestMaterialization>;
  };
  let releaseJson: string;
  let projectionId: string;
  let calculationAsOf: string;
  let selection: AflTradePublicationReadSelection;
  let evaluatedAt: string;
  let clockCalls: number;
  let providerMode: 'none' | 'failed' | 'throw';
  let releaseSource: { loadRelease: ReturnType<typeof vi.fn> };
  let failedCandidateProvider: AflTradeProjectionFailedCandidateProvider;
  let repository: AflTradeProjectionArtifactReadRepository;

  beforeAll(() => {
    fixture = createAflTradeProjectionManifestFixture();
    const input = createAflTradeProjectionManifestMaterializationInput(fixture);
    const output = createAflTradeProjectionManifestMaterialization(input);
    release = { ...input, output };
    releaseJson = JSON.stringify(release);
    projectionId = output.projectionManifest.projectionId;
    calculationAsOf = output.projectionManifest.content.projectionMaterialization.calculationAsOf;
    const publication = fixture.projectionDocumentSetVerification.publicationManifest;
    selection = {
      publication: {
        publicationId: publication.publicationId,
        state: 'published',
        valuationBundleId: publication.content.valuationBundleId,
        valueUnitId: publication.content.valueUnitId,
        publishedAt: CHECKED_AT,
      },
      projectionBuildId: projectionId,
      registryRevision: 7,
      scopeKey: publication.content.scopeKey,
      supportedViews: [...publication.content.supportedViews],
      supportedCohorts: [...publication.content.supportedCohorts],
      excludedCohorts: [...publication.content.excludedCohorts],
    };
  }, 30_000);

  beforeEach(async () => {
    evaluatedAt = isoAfter(CHECKED_AT, 1);
    clockCalls = 0;
    providerMode = 'none';
    releaseSource = { loadRelease: vi.fn(async () => releaseJson) };
    failedCandidateProvider = {
      async capture(activeSelection) {
        if (providerMode === 'throw') throw new Error('candidate store unavailable');
        if (providerMode === 'none') return null;
        return {
          candidatePublicationId: otherId('publication', 'failed-candidate'),
          candidateProjectionBuildId: otherId('projection', 'failed-candidate'),
          scopeKey: activeSelection.scopeKey,
          valueUnitId: activeSelection.publication.valueUnitId,
          startedAt: isoAfter(CHECKED_AT, 10_000),
          failedAt: isoAfter(CHECKED_AT, 20_000),
          failureCode: 'projection_refresh_failed',
        };
      },
    };
    repository = await createAflTradeProjectionArtifactReadRepository({
      projectionId,
      releaseSource,
      failedCandidateProvider,
      clock: () => {
        clockCalls += 1;
        return evaluatedAt;
      },
    });
  }, 30_000);

  it('mounts string and UTF-8 byte releases by exact ID and never reloads during reads', async () => {
    expect(releaseSource.loadRelease).toHaveBeenCalledTimes(1);
    expect(releaseSource.loadRelease).toHaveBeenCalledWith(projectionId, {
      maxBytes: AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES,
    });

    const listRequest = {
      scopeKey: selection.scopeKey,
      requestedView: AFL_TRADE_VALUATION_VIEWS[0],
      tradeIds: [...fixture.tradeIds],
      limit: fixture.tradeIds.length,
      cursor: null,
    };
    await repository.list(selection, listRequest);
    await repository.detail(selection, {
      scopeKey: selection.scopeKey,
      tradeId: fixture.tradeIds[0],
      requestedViews: [AFL_TRADE_VALUATION_VIEWS[0]],
    });
    await repository.read(selection);
    expect(releaseSource.loadRelease).toHaveBeenCalledTimes(1);

    const byteSource = {
      loadRelease: vi.fn(async () => new TextEncoder().encode(releaseJson)),
    };
    const byteRepository = await createAflTradeProjectionArtifactReadRepository({
      projectionId,
      releaseSource: byteSource,
      clock: () => evaluatedAt,
    });
    expect(byteSource.loadRelease).toHaveBeenCalledOnce();
    expect((await byteRepository.list(selection, listRequest)).items).toHaveLength(1);
  }, 30_000);

  it('serves list, detail, methodology, and exact projection export payloads in request order', async () => {
    const requestedViews = [...AFL_TRADE_VALUATION_VIEWS].reverse();
    const tradeIds = [...fixture.tradeIds];
    const list = await repository.list(selection, {
      scopeKey: selection.scopeKey,
      requestedView: requestedViews[0],
      tradeIds,
      limit: tradeIds.length,
      cursor: null,
    });
    expect(list.items.map(({ tradeId }) => tradeId)).toEqual(tradeIds);
    expect(list.items.every(({ valuation }) => valuation.view === requestedViews[0])).toBe(true);
    expect(list.total).toBe(tradeIds.length);
    expect(list.nextCursor).toBeNull();

    const detail = await repository.detail(selection, {
      scopeKey: selection.scopeKey,
      tradeId: tradeIds[0],
      requestedViews,
    });
    expect(detail.valuations.map(({ view }) => view)).toEqual(requestedViews);

    const methodology = await repository.read(selection);
    const methodologyDocument = fixture.projectionParityVerification.storedDocuments.find(
      ({ projectionDocument }) => projectionDocument.content.kind === 'methodology'
    );
    expect(methodology.methodologyHref).toBe(AFL_TRADE_METHODOLOGY_HREF);
    expect(methodology.methodology).toEqual(
      methodologyDocument?.projectionDocument.content.kind === 'methodology'
        ? methodologyDocument.projectionDocument.content.methodology
        : null
    );

    const exported = await repository.exportRows(selection, { tradeIds, requestedViews });
    const expectedRows = tradeIds.flatMap((tradeId) =>
      requestedViews.flatMap((view) =>
        fixture.projectionParityVerification.storedDocuments
          .flatMap(({ projectionDocument }) =>
            projectionDocument.content.kind === 'valuation_export_row' &&
            projectionDocument.content.exportRow.tradeId === tradeId &&
            projectionDocument.content.exportRow.view === view
              ? [projectionDocument.content.exportRow]
              : []
          )
          .sort((left, right) => left.rowOrdinal - right.rowOrdinal)
      )
    );
    expect(exported.rows).toEqual(expectedRows);
    expect([...new Set(exported.rows.map(({ view }) => view))]).toEqual(requestedViews);
    for (const view of requestedViews) {
      const ordinals = exported.rows
        .filter((row) => row.tradeId === tradeIds[0] && row.view === view)
        .map(({ rowOrdinal }) => rowOrdinal);
      expect(ordinals).toEqual(ordinals.map((_, index) => index));
    }
    expect(exported.rows.length).toBeGreaterThan(requestedViews.length);
    expect(exported.rows.every((row) => !('expected' in row) && !('actual' in row))).toBe(true);
  });

  it('evaluates current, stale, retained-candidate, and expired freshness once per read', async () => {
    const request = {
      scopeKey: selection.scopeKey,
      requestedView: AFL_TRADE_VALUATION_VIEWS[0],
      tradeIds: [...fixture.tradeIds],
      limit: fixture.tradeIds.length,
      cursor: null,
    };
    const current = await repository.list(selection, request);
    expect(current.metadata.freshness).toBe('current');
    expect(clockCalls).toBe(1);

    evaluatedAt = isoAfter(calculationAsOf, 86_400_001);
    const stale = await repository.list(selection, request);
    expect(stale.metadata.freshness).toBe('stale');
    expect(stale.metadata.warnings.map(({ code }) => code)).toContain('active_publication_stale');
    expect(clockCalls).toBe(2);

    providerMode = 'failed';
    const retained = await repository.list(selection, request);
    expect(retained.metadata.warnings.map(({ code }) => code)).toContain(
      'candidate_refresh_failed_prior_publication_retained'
    );
    expect(clockCalls).toBe(3);

    evaluatedAt = isoAfter(calculationAsOf, 172_800_001);
    await expectReadError(() => repository.list(selection, request), 'PROJECTION_NOT_SERVABLE');
    expect(clockCalls).toBe(4);
  });

  it('fails with a stable read error when failed-candidate capture fails', async () => {
    providerMode = 'throw';
    await expectReadError(() => repository.read(selection), 'FAILED_CANDIDATE_READ_FAILED');
    expect(clockCalls).toBe(0);
  });

  it('rejects selection proxies and accessors without invoking caller traps', async () => {
    let getterCalls = 0;
    const accessorSelection = structuredClone(selection);
    Object.defineProperty(accessorSelection, 'scopeKey', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return selection.scopeKey;
      },
    });
    await expectReadError(
      () => repository.read(accessorSelection as AflTradePublicationReadSelection),
      'SELECTION_MISMATCH'
    );
    expect(getterCalls).toBe(0);

    let ownKeyCalls = 0;
    const proxySelection = new Proxy(structuredClone(selection), {
      ownKeys() {
        ownKeyCalls += 1;
        throw new Error('selection-own-keys');
      },
    });
    await expectReadError(() => repository.read(proxySelection), 'SELECTION_MISMATCH');
    expect(ownKeyCalls).toBe(0);
  });

  it('rejects request proxies and accessors with stable errors and zero trap invocation', async () => {
    let getterCalls = 0;
    const listRequest = {
      scopeKey: selection.scopeKey,
      requestedView: AFL_TRADE_VALUATION_VIEWS[0],
      tradeIds: [...fixture.tradeIds],
      limit: fixture.tradeIds.length,
      cursor: null,
    };
    Object.defineProperty(listRequest, 'scopeKey', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return selection.scopeKey;
      },
    });
    await expectReadError(() => repository.list(selection, listRequest), 'INVALID_READ_REQUEST');
    expect(getterCalls).toBe(0);

    let ownKeyCalls = 0;
    const detailRequest = new Proxy(
      {
        scopeKey: selection.scopeKey,
        tradeId: fixture.tradeIds[0],
        requestedViews: [AFL_TRADE_VALUATION_VIEWS[0]],
      },
      {
        ownKeys() {
          ownKeyCalls += 1;
          throw new Error('request-own-keys');
        },
      }
    );
    await expectReadError(
      () => repository.detail(selection, detailRequest),
      'INVALID_READ_REQUEST'
    );
    await expectReadError(
      () => repository.exportRows(selection, detailRequest as never),
      'INVALID_READ_REQUEST'
    );
    expect(ownKeyCalls).toBe(0);
  });

  it('admits failed-candidate evidence before chronology access', async () => {
    let startedAtCalls = 0;
    const candidate = {
      candidatePublicationId: otherId('publication', 'hostile-candidate'),
      candidateProjectionBuildId: otherId('projection', 'hostile-candidate'),
      scopeKey: selection.scopeKey,
      valueUnitId: selection.publication.valueUnitId,
      failedAt: isoAfter(CHECKED_AT, 20_000),
      failureCode: 'projection_refresh_failed',
    };
    Object.defineProperty(candidate, 'startedAt', {
      enumerable: true,
      get() {
        startedAtCalls += 1;
        return isoAfter(CHECKED_AT, 10_000);
      },
    });
    const candidateRepository = await createAflTradeProjectionArtifactReadRepository({
      projectionId,
      releaseSource: { loadRelease: async () => releaseJson },
      failedCandidateProvider: {
        async capture() {
          return candidate as never;
        },
      },
      clock: () => isoAfter(CHECKED_AT, 30_000),
    });
    await expectReadError(() => candidateRepository.read(selection), 'FRESHNESS_EVALUATION_FAILED');
    expect(startedAtCalls).toBe(0);
  });

  it('fails closed on clock regression and cannot reactivate an expired mounted projection', async () => {
    evaluatedAt = isoAfter(calculationAsOf, 172_800_001);
    await expectReadError(() => repository.read(selection), 'PROJECTION_NOT_SERVABLE');
    expect(clockCalls).toBe(1);

    evaluatedAt = isoAfter(calculationAsOf, 1);
    await expectReadError(() => repository.read(selection), 'FRESHNESS_EVALUATION_FAILED');
    expect(clockCalls).toBe(2);
  });

  it('captures construction dependencies once before mounting', async () => {
    const originalProvider: AflTradeProjectionFailedCandidateProvider = {
      async capture() {
        return null;
      },
    };
    const dependencies = {
      projectionId,
      releaseSource: { loadRelease: async () => releaseJson },
      failedCandidateProvider: originalProvider,
      clock: () => evaluatedAt,
    };
    const capturedRepository = await createAflTradeProjectionArtifactReadRepository(dependencies);
    dependencies.failedCandidateProvider = {
      async capture() {
        throw new Error('mutated provider must not be observed');
      },
    };
    await expect(capturedRepository.read(selection)).resolves.toMatchObject({
      metadata: { freshness: 'current' },
    });
  });

  it.each([
    [
      'projection',
      (value: AflTradePublicationReadSelection): void => {
        value.projectionBuildId = otherId('projection', 'selection');
      },
    ],
    [
      'publication',
      (value: AflTradePublicationReadSelection): void => {
        value.publication.publicationId = otherId('publication', 'selection');
      },
    ],
    [
      'scope',
      (value: AflTradePublicationReadSelection): void => {
        value.scopeKey = 'wrong-public-scope';
      },
    ],
    [
      'value unit',
      (value: AflTradePublicationReadSelection): void => {
        value.publication.valueUnitId = 'wrong-value-unit';
      },
    ],
    [
      'bundle',
      (value: AflTradePublicationReadSelection): void => {
        value.publication.valuationBundleId = otherId('valuation-bundle', 'selection');
      },
    ],
    [
      'views',
      (value: AflTradePublicationReadSelection): void => {
        value.supportedViews = [...value.supportedViews].reverse();
      },
    ],
    [
      'cohorts',
      (value: AflTradePublicationReadSelection): void => {
        value.supportedCohorts = [...value.supportedCohorts, 'extra-cohort'];
      },
    ],
    [
      'exclusions',
      (value: AflTradePublicationReadSelection): void => {
        value.excludedCohorts = [...value.excludedCohorts, 'extra-exclusion'];
      },
    ],
    [
      'state',
      (value: AflTradePublicationReadSelection): void => {
        value.publication.state = 'superseded';
      },
    ],
    [
      'published time',
      (value: AflTradePublicationReadSelection): void => {
        value.publication.publishedAt = '2026-08-05T09:59:59.999Z';
      },
    ],
    [
      'revision',
      (value: AflTradePublicationReadSelection): void => {
        value.registryRevision = 0;
      },
    ],
  ] as const)('rejects a captured selection with %s drift', async (_label, mutate) => {
    const mismatched = structuredClone(selection);
    mutate(mismatched);
    await expectReadError(() => repository.read(mismatched), 'SELECTION_MISMATCH');
  });

  it('rejects unknown trades and invalid list, detail, and export requests', async () => {
    const unknownTradeId = 'unknown-trade';
    await expectReadError(
      () =>
        repository.list(selection, {
          scopeKey: selection.scopeKey,
          requestedView: AFL_TRADE_VALUATION_VIEWS[0],
          tradeIds: [unknownTradeId],
          limit: 1,
          cursor: null,
        }),
      'TRADE_NOT_IN_PROJECTION'
    );
    await expectReadError(
      () =>
        repository.list(selection, {
          scopeKey: selection.scopeKey,
          requestedView: AFL_TRADE_VALUATION_VIEWS[0],
          tradeIds: [...fixture.tradeIds],
          limit: fixture.tradeIds.length,
          cursor: 'latest',
        }),
      'INVALID_READ_REQUEST'
    );
    await expectReadError(
      () =>
        repository.detail(selection, {
          scopeKey: selection.scopeKey,
          tradeId: fixture.tradeIds[0],
          requestedViews: [AFL_TRADE_VALUATION_VIEWS[0], AFL_TRADE_VALUATION_VIEWS[0]],
        }),
      'INVALID_READ_REQUEST'
    );
    await expectReadError(
      () =>
        repository.exportRows(selection, {
          tradeIds: fixture.tradeIds,
          requestedViews: ['latest'] as never,
        }),
      'INVALID_READ_REQUEST'
    );
  });

  it('returns stable branded mount errors for malformed and unavailable exact releases', async () => {
    await expectMountError(
      () =>
        createAflTradeProjectionArtifactReadRepository({
          projectionId: 'latest',
          releaseSource,
        }),
      'INVALID_PROJECTION_ID'
    );
    await expectMountError(
      () =>
        createAflTradeProjectionArtifactReadRepository({
          projectionId,
          releaseSource: { loadRelease: async () => null },
        }),
      'RELEASE_NOT_FOUND'
    );
    await expectMountError(
      () =>
        createAflTradeProjectionArtifactReadRepository({
          projectionId,
          releaseSource: {
            loadRelease: async () => {
              throw new Error('object store unavailable');
            },
          },
        }),
      'RELEASE_READ_FAILED'
    );
    await expectMountError(
      () =>
        createAflTradeProjectionArtifactReadRepository({
          projectionId,
          releaseSource: { loadRelease: async () => 42 as never },
        }),
      'INVALID_RELEASE_TYPE'
    );
    await expectMountError(
      () =>
        createAflTradeProjectionArtifactReadRepository({
          projectionId,
          releaseSource: { loadRelease: async () => Uint8Array.from([0xc3, 0x28]) },
        }),
      'INVALID_RELEASE_ENCODING'
    );
    await expectMountError(
      () =>
        createAflTradeProjectionArtifactReadRepository({
          projectionId,
          releaseSource: { loadRelease: async () => '{' },
        }),
      'INVALID_RELEASE_JSON'
    );
  });

  it('rejects tampered authenticated output and a release returned for another exact ID', async () => {
    const tampered = structuredClone(release);
    tampered.output.projectionManifestArtifactRef.byteLength += 1;
    await expectMountError(
      () =>
        createAflTradeProjectionArtifactReadRepository({
          projectionId,
          releaseSource: { loadRelease: async () => JSON.stringify(tampered) },
        }),
      'RELEASE_AUTHENTICATION_FAILED'
    );

    await expectMountError(
      () =>
        createAflTradeProjectionArtifactReadRepository({
          projectionId: otherId('projection', 'exact-request'),
          releaseSource: { loadRelease: async () => releaseJson },
        }),
      'PROJECTION_ID_MISMATCH'
    );
  }, 30_000);

  it('declares the bounded exact-read, no-latest, no-fallback, non-owning contract', () => {
    expect(AFL_TRADE_PROJECTION_ARTIFACT_READ_RELEASE_MAX_BYTES).toBe(128 * 1024 * 1024);
    expect(AFL_TRADE_PROJECTION_ARTIFACT_READ_PUBLIC_ASSET_BOUNDARY).toBe(
      'source_native_afl_assets_no_user_or_fantasy_ownership'
    );
    expect(AFL_TRADE_PROJECTION_ARTIFACT_READ_SELECTION).toContain('no_latest_alias');
    expect(AFL_TRADE_PROJECTION_ARTIFACT_READ_RUNTIME_FALLBACK).toBe('prohibited');
    expect(AFL_TRADE_PROJECTION_ARTIFACT_READ_CLOCK_POLICY).toContain('no_expiry_reactivation');
    expect(AFL_TRADE_PROJECTION_ARTIFACT_READ_FAILED_CANDIDATE_BINDING).toContain(
      'candidate_must_start_after_active_publication'
    );
    expect(AFL_TRADE_PROJECTION_ARTIFACT_READ_LIMITATION).toContain(
      'does not activate or select publications'
    );
    expect(AFL_TRADE_PROJECTION_ARTIFACT_READ_LIMITATION).toContain(
      'establish user or fantasy ownership'
    );
    expect(Object.keys(repository).sort()).toEqual(['detail', 'exportRows', 'list', 'read']);
    expect(Object.isFrozen(repository)).toBe(true);
  });
});
