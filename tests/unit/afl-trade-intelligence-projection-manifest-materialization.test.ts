// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { doesAflTradeArtifactRefMatchCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY } from '@/server/aflTradeIntelligence/publication/projectionDocumentContracts';
import { createAflTradeFreshnessPolicy } from '@/server/aflTradeIntelligence/publication/freshnessPolicy';
import {
  AFL_TRADE_PROJECTION_MANIFEST_BUILD_JOB_ID_AUTHORITY,
  AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_LIMITATION,
  AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_ARTIFACT_BYTES,
  AflTradeProjectionManifestMaterializationError,
  aflTradeCustodiedProjectionManifestMaterializationResultSchema,
  aflTradeProjectionManifestMaterializationCreateInputSchema,
  aflTradeProjectionManifestMaterializationResultSchema,
  authenticateAflTradeProjectionManifestMaterialization,
  createAflTradeCustodiedProjectionManifestMaterialization,
  createAflTradeProjectionManifestMaterialization,
  isAflTradeProjectionManifestMaterializationError,
  verifyAflTradeCustodiedProjectionManifestMaterialization,
  verifyAflTradeProjectionManifestMaterialization,
  type AflTradeProjectionManifestMaterializationErrorCode,
} from '@/server/aflTradeIntelligence/publication/projectionManifestMaterialization';
import {
  createAflTradeProjectionParityReport,
  verifyAflTradeProjectionParityReport,
} from '@/server/aflTradeIntelligence/publication/projectionParity';
import {
  CHECKED_AT,
  POLICY_AT,
  SCOPE_KEY,
  VALUE_UNIT_ID,
  createAflTradeCustodiedProjectionManifestFixture,
  createAflTradeProjectionManifestFixture,
  createAflTradeProjectionManifestMaterializationInput,
  createAflTradeValuationOutputCustodyIndexVerificationFixture,
} from '../fixtures/aflTradeProjectionManifestFixture';

function expectManifestError(
  action: () => unknown,
  code: AflTradeProjectionManifestMaterializationErrorCode
): AflTradeProjectionManifestMaterializationError {
  try {
    action();
  } catch (error) {
    expect(isAflTradeProjectionManifestMaterializationError(error)).toBe(true);
    expect(error).toBeInstanceOf(AflTradeProjectionManifestMaterializationError);
    expect((error as AflTradeProjectionManifestMaterializationError).code).toBe(code);
    return error as AflTradeProjectionManifestMaterializationError;
  }
  throw new Error(`Expected projection manifest materialization error ${code}.`);
}

function objectKeys(value: unknown, keys = new Set<string>(), seen = new WeakSet<object>()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return keys;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    objectKeys(child, keys, seen);
  }
  return keys;
}

describe('AFL trade projection manifest materialization', () => {
  it('materializes and replays a custody-bound publication v4 as projection v3', async () => {
    const custodyIndexVerification =
      await createAflTradeValuationOutputCustodyIndexVerificationFixture();
    const fixture = createAflTradeCustodiedProjectionManifestFixture(custodyIndexVerification);
    const input = {
      ...createAflTradeProjectionManifestMaterializationInput(fixture),
      custodyIndexVerification,
    };

    const output = createAflTradeCustodiedProjectionManifestMaterialization(input);

    expect(output.projectionManifest.content).toMatchObject({
      schemaVersion: 'afl-trade-projection/v3',
      publicationId: fixture.identity.publicationId,
      projectionSchemaBundle: {
        schemaVersion: 'afl-trade-projection-schema-bundle/v2',
        publicationManifestSchemaVersion: 'afl-trade-publication/v4',
        projectionManifestSchemaVersion: 'afl-trade-projection/v3',
      },
      valuationOutputCustodyIndex: {
        valuationOutputCustodyIndexId:
          custodyIndexVerification.output.valuationOutputCustodyIndex.valuationOutputCustodyIndexId,
      },
    });
    expect(aflTradeCustodiedProjectionManifestMaterializationResultSchema.parse(output)).toEqual(
      output
    );
    expect(verifyAflTradeCustodiedProjectionManifestMaterialization({ ...input, output })).toBe(
      true
    );

    const tampered = structuredClone(output);
    tampered.projectionManifest.content.valuationOutputCustodyIndex.custodyReceiptSetSha256 =
      'f'.repeat(64);
    expect(
      verifyAflTradeCustodiedProjectionManifestMaterialization({ ...input, output: tampered })
    ).toBe(false);
  });

  it('creates deterministically from a fully replayed passing chain and authenticates exact bytes', () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const input = createAflTradeProjectionManifestMaterializationInput(fixture);
    const first = createAflTradeProjectionManifestMaterialization(input);
    const second = createAflTradeProjectionManifestMaterialization(structuredClone(input));
    const content = first.projectionManifest.content;
    const parity = fixture.projectionParityVerification.output.projectionParityReport.content;

    expect(second).toEqual(first);
    expect(content).toMatchObject({
      publicationId: fixture.projectionDocumentSetVerification.publicationManifest.publicationId,
      documentCount: 14,
      projectionMaterialization:
        fixture.projectionDocumentSet.projectionDocumentSet.content.projectionMaterialization,
      parityReport: {
        status: 'passed',
        checkCount: 116,
        failureCount: 0,
        checkedDocumentCount: 14,
      },
    });
    expect(parity).toMatchObject({
      status: 'passed',
      checkedDocumentCount: 14,
      expectedDocumentCount: 14,
      storedDocumentCount: 14,
      checkCount: 116,
      failureCount: 0,
    });
    expect(first.projectionManifest.projectionId).toBe(
      createAflTradeContentAddress('projection', content)
    );
    expect(
      doesAflTradeArtifactRefMatchCanonicalJson(
        first.projectionManifestArtifactRef,
        first.projectionManifest
      )
    ).toBe(true);
    expect(first.projectionManifestArtifactRef.createdAt).toBe(CHECKED_AT);
    expect(first.projectionManifestArtifactRef.byteLength).toBeLessThanOrEqual(
      AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_MAX_ARTIFACT_BYTES
    );
    expect(aflTradeProjectionManifestMaterializationResultSchema.parse(first)).toEqual(first);
    expect(verifyAflTradeProjectionManifestMaterialization({ ...input, output: first })).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('authenticates to replay-derived output and returns null for mismatched output or input', () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const input = createAflTradeProjectionManifestMaterializationInput(fixture);
    const output = createAflTradeProjectionManifestMaterialization(input);
    const authenticated = authenticateAflTradeProjectionManifestMaterialization({
      ...input,
      output,
    });

    expect(authenticated).toEqual(output);
    expect(authenticated).not.toBe(output);
    const tamperedOutput = structuredClone(output);
    tamperedOutput.projectionManifestArtifactRef.byteLength += 1;
    expect(
      authenticateAflTradeProjectionManifestMaterialization({
        ...input,
        output: tamperedOutput,
      })
    ).toBeNull();
    expect(
      authenticateAflTradeProjectionManifestMaterialization({
        ...input,
        buildJobId: 'projection-manifest-build:mismatch',
        output,
      })
    ).toBeNull();
  });

  it('rejects a totally replayable parity report whose stored-document parity failed', () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const failedParityInput = { ...fixture.input, storedDocuments: [] };
    const failedParityOutput = createAflTradeProjectionParityReport(failedParityInput);
    expect(failedParityOutput.projectionParityReport.content.status).toBe('failed');
    expect(
      verifyAflTradeProjectionParityReport({ ...failedParityInput, output: failedParityOutput })
    ).toBe(true);

    expectManifestError(
      () =>
        createAflTradeProjectionManifestMaterialization({
          ...createAflTradeProjectionManifestMaterializationInput(fixture),
          projectionParityVerification: {
            ...failedParityInput,
            output: failedParityOutput,
          },
        }),
      'PARITY_NOT_PASSED'
    );
  });

  it('rejects authentic freshness substitutions for duration, scope, and value unit separately', () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const input = createAflTradeProjectionManifestMaterializationInput(fixture);
    const variants = [
      createAflTradeFreshnessPolicy({
        scopeKey: SCOPE_KEY,
        valueUnitId: VALUE_UNIT_ID,
        currentDurationSeconds: 172_800,
        staleServeDurationSeconds: 86_400,
        createdAt: POLICY_AT,
      }),
      createAflTradeFreshnessPolicy({
        scopeKey: 'different-projection-scope',
        valueUnitId: VALUE_UNIT_ID,
        currentDurationSeconds: 86_400,
        staleServeDurationSeconds: 86_400,
        createdAt: POLICY_AT,
      }),
      createAflTradeFreshnessPolicy({
        scopeKey: SCOPE_KEY,
        valueUnitId: 'different-football-value-unit',
        currentDurationSeconds: 86_400,
        staleServeDurationSeconds: 86_400,
        createdAt: POLICY_AT,
      }),
    ];
    for (const freshnessPolicyResult of variants) {
      expectManifestError(
        () =>
          createAflTradeProjectionManifestMaterialization({
            ...input,
            freshnessPolicyResult,
          }),
        'FRESHNESS_BINDING_MISMATCH'
      );
    }

    const tamperedFreshness = structuredClone(fixture.freshnessPolicyResult);
    tamperedFreshness.freshnessPolicyArtifactRef.byteLength += 1;
    expectManifestError(
      () =>
        createAflTradeProjectionManifestMaterialization({
          ...input,
          freshnessPolicyResult: tamperedFreshness,
        }),
      'INVALID_FRESHNESS_POLICY_RESULT'
    );
  });

  it('rejects same-count independently constructed cross-pipeline parent splices', () => {
    const left = createAflTradeProjectionManifestFixture('two_party_player_swap');
    const right = createAflTradeProjectionManifestFixture('future_pick_resolution');
    expect(right.projectionDocumentSet.projectionDocumentSet.content.documentCount).toBe(
      left.projectionDocumentSet.projectionDocumentSet.content.documentCount
    );
    expect(right.identity.publicationId).not.toBe(left.identity.publicationId);

    const replayableSplices = [
      {
        label: 'policy',
        input: {
          ...left.input,
          projectionPresentationPolicy: right.projectionPresentationPolicy,
        },
      },
      {
        label: 'evidence',
        input: {
          ...left.input,
          projectionPublicEvidenceIndex: right.projectionPublicEvidenceIndex,
        },
      },
      {
        label: 'schema',
        input: { ...left.input, projectionSchemaBundle: right.projectionSchemaBundle },
      },
      {
        label: 'document-set',
        input: {
          ...left.input,
          projectionDocumentSetVerification: right.projectionDocumentSetVerification,
        },
      },
    ];
    for (const splice of replayableSplices) {
      const output = createAflTradeProjectionParityReport(splice.input);
      expect(output.projectionParityReport.content.status, splice.label).toBe('failed');
      expectManifestError(
        () =>
          createAflTradeProjectionManifestMaterialization({
            ...createAflTradeProjectionManifestMaterializationInput(left),
            projectionParityVerification: { ...splice.input, output },
          }),
        'PARITY_NOT_PASSED'
      );
    }

    const invalidSplices = [
      (() => {
        const verification = structuredClone(left.projectionParityVerification);
        verification.projectionDocumentSetVerification.projectionMaterializationVerification =
          right.projectionDocumentSetVerification.projectionMaterializationVerification;
        return verification;
      })(),
      (() => {
        const verification = structuredClone(left.projectionParityVerification);
        verification.projectionDocumentSetVerification.publicationManifest =
          right.projectionDocumentSetVerification.publicationManifest;
        return verification;
      })(),
      { ...left.projectionParityVerification, output: right.projectionParityVerification.output },
    ];
    for (const projectionParityVerification of invalidSplices) {
      expectManifestError(
        () =>
          createAflTradeProjectionManifestMaterialization({
            ...createAflTradeProjectionManifestMaterializationInput(left),
            projectionParityVerification,
          }),
        'INVALID_PROJECTION_PARITY_VERIFICATION'
      );
    }
  });

  it('treats build job as an operational non-provenance label with deterministic output identity', () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const input = createAflTradeProjectionManifestMaterializationInput(fixture);
    const first = createAflTradeProjectionManifestMaterialization(input);
    const relabelled = createAflTradeProjectionManifestMaterialization({
      ...input,
      buildJobId: 'projection-manifest-build:relabelled',
    });

    expect(AFL_TRADE_PROJECTION_MANIFEST_BUILD_JOB_ID_AUTHORITY).toBe(
      'operational_correlation_label_only_not_authenticated_provenance_v1'
    );
    expect(AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_LIMITATION).toContain(
      'operational correlation label, not authenticated provenance'
    );
    expect(AFL_TRADE_PROJECTION_MANIFEST_MATERIALIZATION_LIMITATION).toContain(
      'future upstream build receipt'
    );
    expect(relabelled.projectionManifest.projectionId).not.toBe(
      first.projectionManifest.projectionId
    );
    expect(relabelled.projectionManifest.content.buildJobId).toBe(
      'projection-manifest-build:relabelled'
    );
    expect(relabelled.projectionManifest.content.publicationId).toBe(
      first.projectionManifest.content.publicationId
    );
    expect(relabelled.projectionManifest.content.projectionMaterialization).toEqual(
      first.projectionManifest.content.projectionMaterialization
    );
    expect(input.projectionParityVerification).toBe(fixture.projectionParityVerification);
  });

  it('rejects top-level and nested proxies/accessors without invoking stateful getters', () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const input = createAflTradeProjectionManifestMaterializationInput(fixture);
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('hostile-own-keys');
        },
      }
    );
    expectManifestError(
      () => createAflTradeProjectionManifestMaterialization(hostile),
      'INVALID_INPUT_ENVELOPE'
    );
    expectManifestError(
      () => createAflTradeProjectionManifestMaterialization({ ...input, extra: true }),
      'INVALID_INPUT_ENVELOPE'
    );

    const topReads = new Map<string, number>();
    const accessorEnvelope = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          {
            enumerable: true,
            get() {
              topReads.set(key, (topReads.get(key) ?? 0) + 1);
              return value;
            },
          },
        ])
      )
    );
    expectManifestError(
      () => createAflTradeProjectionManifestMaterialization(accessorEnvelope),
      'INVALID_INPUT_ENVELOPE'
    );
    expect([...topReads.values()]).toEqual([]);

    let nestedReads = 0;
    const nestedAccessor = structuredClone(input.projectionParityVerification);
    const nestedOutput = nestedAccessor.output;
    Object.defineProperty(nestedAccessor, 'output', {
      enumerable: true,
      get() {
        nestedReads += 1;
        return nestedReads % 2 === 0 ? structuredClone(nestedOutput) : nestedOutput;
      },
    });
    expectManifestError(
      () =>
        createAflTradeProjectionManifestMaterialization({
          ...input,
          projectionParityVerification: nestedAccessor,
        }),
      'INVALID_INPUT_ENVELOPE'
    );
    expect(nestedReads).toBe(0);

    expectManifestError(
      () =>
        createAflTradeProjectionManifestMaterialization({
          ...input,
          projectionParityVerification: new Proxy(input.projectionParityVerification, {}),
        }),
      'INVALID_INPUT_ENVELOPE'
    );
    const output = createAflTradeProjectionManifestMaterialization(input);
    expect(verifyAflTradeProjectionManifestMaterialization({ ...input, output, extra: true })).toBe(
      false
    );
  });

  it('keeps serialized input/output schemas and artifacts free of user or fantasy ownership', () => {
    const fixture = createAflTradeProjectionManifestFixture();
    const input = createAflTradeProjectionManifestMaterializationInput(fixture);
    const output = createAflTradeProjectionManifestMaterialization(input);
    const forbidden = [
      'userId',
      'ownerId',
      'ownership',
      'fantasyLeagueId',
      'leagueId',
      'rosterId',
      'fantasyTeamId',
    ];
    const keys = new Set([...objectKeys(input), ...objectKeys(output)]);
    for (const key of forbidden) expect(keys.has(key)).toBe(false);
    const schemaFieldNames = new Set([
      ...Object.keys(aflTradeProjectionManifestMaterializationCreateInputSchema.shape),
      ...Object.keys(aflTradeProjectionManifestMaterializationResultSchema.shape),
    ]);
    for (const key of forbidden) expect(schemaFieldNames.has(key)).toBe(false);
    expect(output.projectionManifest.content.publicAssetBoundary).toBe(
      AFL_TRADE_PROJECTION_PUBLIC_ASSET_BOUNDARY
    );
  });
});
