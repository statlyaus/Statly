import { describe, expect, it } from 'vitest';

import {
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_DIGEST_DEFINITION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_ORDERING,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SET_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_EXPORT_CONTRACT_VERSION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_LIMITATION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MAX_BYTES,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PREDECESSOR_COMPATIBILITY,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PROJECTION_MANIFEST_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_ASSET_BOUNDARY,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RESPONSE_CONTRACT_VERSION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RUNTIME_FALLBACK,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_DESCRIPTORS,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PROJECTION_MANIFEST_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PUBLICATION_MANIFEST_SCHEMA_VERSION,
  AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_SCHEMA_VERSION,
  AflTradeProjectionSchemaBundleConstructionError,
  aflTradeProjectionSchemaBundleContentSchema,
  aflTradeProjectionSchemaBundleResultSchema,
  createAflTradeProjectionSchemaBundle,
  createAflTradeProjectionSchemaBundleV2,
  isAflTradeProjectionSchemaBundleConstructionError,
  verifyAflTradeProjectionSchemaBundleDerivation,
  type AflTradeProjectionSchemaBundleConstructionErrorCode,
  type AflTradeProjectionSchemaBundleResult,
} from '@/server/aflTradeIntelligence/publication/projectionSchemaBundle';
import { doesAflTradeArtifactRefMatchCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeContentAddress,
  sha256AflTradeCanonicalJson,
} from '@/server/aflTradeIntelligence/artifacts/contentAddress';

const createdAt = '2026-08-05T04:00:00.000Z';
const newlyGovernedDescriptors = [
  [
    'projection_evidence_source_verification',
    'afl-trade-projection-evidence-source-verification/v1',
  ],
  ['projection_trade_materialization', 'afl-trade-projection-trade-materialization/v1'],
  ['projection_materialization_shard', 'afl-trade-projection-materialization-shard/v1'],
  ['projection_materialization', 'afl-trade-projection-materialization/v1'],
  ['projection_document_set_shard', 'afl-trade-projection-document-set-shard/v1'],
] as const;

function createBundle(timestamp = createdAt): AflTradeProjectionSchemaBundleResult {
  return createAflTradeProjectionSchemaBundle({ createdAt: timestamp });
}

function expectConstructionError(
  action: () => unknown,
  code: AflTradeProjectionSchemaBundleConstructionErrorCode
): AflTradeProjectionSchemaBundleConstructionError {
  try {
    action();
  } catch (error) {
    expect(isAflTradeProjectionSchemaBundleConstructionError(error)).toBe(true);
    expect(error).toMatchObject({ code });
    return error as AflTradeProjectionSchemaBundleConstructionError;
  }
  throw new Error(`Expected projection schema-bundle construction error ${code}.`);
}

function isDeeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true;
  seen.add(value);
  return (
    Object.isFrozen(value) && Object.values(value).every((entry) => isDeeplyFrozen(entry, seen))
  );
}

function collectKeys(value: unknown, keys = new Set<string>(), seen = new WeakSet<object>()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return keys;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    keys.add(key);
    collectKeys(nested, keys, seen);
  }
  return keys;
}

describe('AFL trade-intelligence projection schema bundle', () => {
  it('adds a v2 bundle for publication v4 and projection v3 without changing v1', () => {
    const legacy = createBundle();
    const current = createAflTradeProjectionSchemaBundleV2({ createdAt });

    expect(legacy.projectionSchemaBundle.content.schemaVersion).toBe(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION
    );
    expect(
      legacy.projectionSchemaBundle.content.descriptors.find(
        ({ role }) => role === 'publication_manifest'
      )?.version
    ).toBe('afl-trade-publication/v3');
    expect(legacy.projectionSchemaBundle.content.projectionManifestSchemaVersion).toBe(
      'afl-trade-projection/v2'
    );
    expect(current.projectionSchemaBundle.content).toMatchObject({
      schemaVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_SCHEMA_VERSION,
      publicationManifestSchemaVersion:
        AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PUBLICATION_MANIFEST_SCHEMA_VERSION,
      projectionManifestSchemaVersion:
        AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_PROJECTION_MANIFEST_SCHEMA_VERSION,
      predecessorPolicy: {
        predecessorSchemaVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION,
        compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PREDECESSOR_COMPATIBILITY,
        runtimeFallback: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RUNTIME_FALLBACK,
      },
    });
    expect(
      current.projectionSchemaBundle.content.descriptors.map(({ role, version }) => [role, version])
    ).toEqual(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_V2_DESCRIPTORS.map(({ role, version }) => [role, version])
    );
    expect(
      current.projectionSchemaBundle.content.descriptors.find(
        ({ role }) => role === 'publication_manifest'
      )?.version
    ).toBe('afl-trade-publication/v4');
    expect(
      current.projectionSchemaBundle.content.descriptors.find(
        ({ role }) => role === 'projection_manifest'
      )?.version
    ).toBe('afl-trade-projection/v3');
    expect(current.projectionSchemaBundle.projectionSchemaBundleId).not.toBe(
      legacy.projectionSchemaBundle.projectionSchemaBundleId
    );
    expect(isDeeplyFrozen(current)).toBe(true);
  });

  it('declares all nineteen frozen release-DAG descriptors in governed topological order', () => {
    const output = createBundle();
    const expected = [
      ['public_trade_value_list_response', 'afl-trade-value/v2'],
      ['public_trade_value_detail_response', 'afl-trade-value/v2'],
      ['public_trade_methodology_response', 'afl-trade-value/v2'],
      ['valuation_export', 'afl-trade-valuation-csv/v1'],
      ['valuation_output_inventory_index', 'afl-trade-valuation-output-inventory-index/v1'],
      ['publication_freshness_policy', 'afl-trade-publication-freshness-policy/v1'],
      ['projection_presentation_policy', 'afl-trade-projection-presentation-policy/v1'],
      ['publication_manifest', 'afl-trade-publication/v3'],
      ['projection_public_evidence', 'afl-trade-projection-public-evidence/v1'],
      ['projection_public_evidence_index', 'afl-trade-projection-public-evidence-index/v1'],
      [
        'projection_evidence_source_verification',
        'afl-trade-projection-evidence-source-verification/v1',
      ],
      ['projection_document', 'afl-trade-projection-document/v1'],
      ['projection_trade_materialization', 'afl-trade-projection-trade-materialization/v1'],
      ['projection_materialization_shard', 'afl-trade-projection-materialization-shard/v1'],
      ['projection_materialization', 'afl-trade-projection-materialization/v1'],
      ['projection_document_set_shard', 'afl-trade-projection-document-set-shard/v1'],
      ['projection_document_set', 'afl-trade-projection-document-set/v1'],
      ['projection_parity_report', 'afl-trade-projection-parity-report/v1'],
      ['projection_manifest', 'afl-trade-projection/v2'],
    ];

    expect(output.projectionSchemaBundle.content.descriptorCount).toBe(19);
    expect(
      output.projectionSchemaBundle.content.descriptors.map(({ role, version }) => [role, version])
    ).toEqual(expected);
    expect(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS).toEqual(
      output.projectionSchemaBundle.content.descriptors
    );
    expect(Object.isFrozen(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS)).toBe(true);
    expect(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTORS.every(Object.isFrozen)).toBe(true);
  });

  it('authenticates descriptor digest, bundle address, canonical bytes, and exact creation time', () => {
    const output = createBundle();
    const { projectionSchemaBundle: bundle, projectionSchemaBundleArtifactRef: reference } = output;

    expect(bundle.content.descriptorSetSha256).toBe(
      '2298c6b7b6cf86a79a59e6a448cca02228c8db2e52d758a1dc057cbab39afd2f'
    );
    expect(bundle.content.descriptorSetSha256).toBe(
      sha256AflTradeCanonicalJson(bundle.content.descriptors)
    );
    expect(bundle.projectionSchemaBundleId).toBe(
      'projection-schema-bundle:b0a769dfe6f6a535b15db950cc4d0e7ab1cecda9478a4e22d5a06601401c83cd'
    );
    expect(bundle.projectionSchemaBundleId).toBe(
      createAflTradeContentAddress('projection-schema-bundle', bundle.content)
    );
    expect(reference).toEqual({
      artifactId: 'artifact:b0e0a9e06783b1ba4418a4c902e7e5ca7bdf4b64d0ae9503c7fe873131228c99',
      contentSha256: 'b0e0a9e06783b1ba4418a4c902e7e5ca7bdf4b64d0ae9503c7fe873131228c99',
      storageUri:
        'artifact://sha256/b0e0a9e06783b1ba4418a4c902e7e5ca7bdf4b64d0ae9503c7fe873131228c99',
      mediaType: 'application/json',
      byteLength: 4455,
      createdAt,
    });
    expect(doesAflTradeArtifactRefMatchCanonicalJson(reference, bundle)).toBe(true);
    expect(reference.createdAt).toBe(bundle.content.createdAt);
    expect(reference.mediaType).toBe('application/json');
    expect(reference.byteLength).toBeGreaterThan(0);
    expect(reference.byteLength).toBeLessThanOrEqual(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MAX_BYTES);
    expect(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MAX_BYTES).toBe(64 * 1024);
    expect(createBundle()).toEqual(output);
    expect(verifyAflTradeProjectionSchemaBundleDerivation({ createdAt, output })).toBe(true);
  });

  it('rejects descriptor digest, governed version, compatibility, and order drift', () => {
    const content = structuredClone(createBundle().projectionSchemaBundle.content);
    const methodologyIndex = content.descriptors.findIndex(
      (descriptor) => descriptor.role === 'public_trade_methodology_response'
    );
    expect(methodologyIndex).toBe(2);

    const digestDrift = { ...content, descriptorSetSha256: 'f'.repeat(64) };
    expect(aflTradeProjectionSchemaBundleContentSchema.safeParse(digestDrift).success).toBe(false);

    const versionDrift = structuredClone(content);
    versionDrift.descriptors[methodologyIndex].version = 'afl-trade-value/v1';
    versionDrift.descriptorSetSha256 = sha256AflTradeCanonicalJson(versionDrift.descriptors);
    expect(aflTradeProjectionSchemaBundleContentSchema.safeParse(versionDrift).success).toBe(false);

    const compatibilityDrift = structuredClone(content);
    compatibilityDrift.descriptors[0].compatibility = 'implicit-conversion-allowed' as never;
    expect(aflTradeProjectionSchemaBundleContentSchema.safeParse(compatibilityDrift).success).toBe(
      false
    );

    const orderDrift = structuredClone(content);
    orderDrift.descriptors.reverse();
    orderDrift.descriptorSetSha256 = sha256AflTradeCanonicalJson(orderDrift.descriptors);
    expect(aflTradeProjectionSchemaBundleContentSchema.safeParse(orderDrift).success).toBe(false);
  });

  it.each(newlyGovernedDescriptors)(
    'rejects omission, reordering, and version substitution for %s',
    (role, version) => {
      const content = structuredClone(createBundle().projectionSchemaBundle.content);
      const descriptorIndex = content.descriptors.findIndex(
        (descriptor) => descriptor.role === role
      );
      expect(descriptorIndex).toBeGreaterThanOrEqual(0);
      expect(content.descriptors[descriptorIndex]?.version).toBe(version);

      const omission = structuredClone(content);
      omission.descriptors.splice(descriptorIndex, 1);
      omission.descriptorSetSha256 = sha256AflTradeCanonicalJson(omission.descriptors);
      expect(aflTradeProjectionSchemaBundleContentSchema.safeParse(omission).success).toBe(false);

      const reordering = structuredClone(content);
      const adjacentIndex = descriptorIndex === 0 ? 1 : descriptorIndex - 1;
      [reordering.descriptors[descriptorIndex], reordering.descriptors[adjacentIndex]] = [
        reordering.descriptors[adjacentIndex],
        reordering.descriptors[descriptorIndex],
      ];
      reordering.descriptorSetSha256 = sha256AflTradeCanonicalJson(reordering.descriptors);
      expect(aflTradeProjectionSchemaBundleContentSchema.safeParse(reordering).success).toBe(false);

      const versionSubstitution = structuredClone(content);
      versionSubstitution.descriptors[descriptorIndex].version = `${version}-substituted`;
      versionSubstitution.descriptorSetSha256 = sha256AflTradeCanonicalJson(
        versionSubstitution.descriptors
      );
      expect(
        aflTradeProjectionSchemaBundleContentSchema.safeParse(versionSubstitution).success
      ).toBe(false);
    }
  );

  it('pins every top-level contract version and the complete canonical view order', () => {
    const content = createBundle().projectionSchemaBundle.content;
    expect(content).toMatchObject({
      schemaVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_SCHEMA_VERSION,
      responseContractVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RESPONSE_CONTRACT_VERSION,
      valuationExportContractVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_EXPORT_CONTRACT_VERSION,
      projectionDocumentSchemaVersion: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SCHEMA_VERSION,
      projectionDocumentSetSchemaVersion:
        AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DOCUMENT_SET_SCHEMA_VERSION,
      projectionManifestSchemaVersion:
        AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PROJECTION_MANIFEST_SCHEMA_VERSION,
      supportedViews: ['at_trade', 'realized', 'remaining', 'current'],
      descriptorOrdering: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_ORDERING,
      descriptorDigestDefinition: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_DIGEST_DEFINITION,
    });

    for (const patch of [
      { responseContractVersion: 'afl-trade-value/v1' },
      { valuationExportContractVersion: 'afl-trade-valuation-csv/v2' },
      { projectionDocumentSchemaVersion: 'afl-trade-projection-document/v2' },
      { projectionDocumentSetSchemaVersion: 'afl-trade-projection-document-set/v2' },
      { projectionManifestSchemaVersion: 'afl-trade-projection/v1' },
      { supportedViews: [...content.supportedViews].reverse() },
    ]) {
      expect(
        aflTradeProjectionSchemaBundleContentSchema.safeParse({ ...content, ...patch }).success
      ).toBe(false);
    }
  });

  it('prohibits predecessor conversion and runtime fallback', () => {
    const content = createBundle().projectionSchemaBundle.content;
    expect(content.predecessorPolicy).toEqual({
      predecessorSchemaVersion: null,
      compatibility: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PREDECESSOR_COMPATIBILITY,
      runtimeFallback: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RUNTIME_FALLBACK,
    });
    expect(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_RUNTIME_FALLBACK).toBe('prohibited');

    for (const predecessorPolicy of [
      { ...content.predecessorPolicy, predecessorSchemaVersion: 'afl-trade-value/v1' },
      { ...content.predecessorPolicy, compatibility: 'implicit-conversion-allowed' },
      { ...content.predecessorPolicy, runtimeFallback: 'allowed' },
    ]) {
      expect(
        aflTradeProjectionSchemaBundleContentSchema.safeParse({
          ...content,
          predecessorPolicy,
        }).success
      ).toBe(false);
    }
  });

  it('enforces exact constructor and derivation envelopes with stable error precedence', () => {
    const missing = {};
    const extra = { createdAt, unexpected: true };
    const symbolExtended = { createdAt, [Symbol('unexpected')]: true };

    for (const input of [null, [], missing, extra, symbolExtended]) {
      const error = expectConstructionError(
        () => createAflTradeProjectionSchemaBundle(input),
        'INVALID_INPUT_ENVELOPE'
      );
      expect(error.message).toBe('The projection schema-bundle input envelope is invalid.');
    }
    expectConstructionError(
      () => createAflTradeProjectionSchemaBundle({ createdAt: 'not-a-date' }),
      'INVALID_CREATED_AT'
    );

    const output = createBundle();
    expect(verifyAflTradeProjectionSchemaBundleDerivation({ createdAt, output })).toBe(true);
    expect(
      verifyAflTradeProjectionSchemaBundleDerivation({ createdAt, output, unexpected: true })
    ).toBe(false);
    expect(
      verifyAflTradeProjectionSchemaBundleDerivation({
        createdAt: '2026-08-05T04:00:01.000Z',
        output,
      })
    ).toBe(false);
  });

  it('contains hostile getters, proxies, symbols, and revoked inputs without rereading fields', () => {
    const throwingGetter = Object.defineProperty({}, 'createdAt', {
      enumerable: true,
      get() {
        throw new Error('private getter detail');
      },
    });
    const throwingProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private proxy detail');
        },
      }
    );
    const revokedCreate = Proxy.revocable({ createdAt }, {});
    revokedCreate.revoke();
    for (const input of [throwingGetter, throwingProxy, revokedCreate.proxy]) {
      expectConstructionError(
        () => createAflTradeProjectionSchemaBundle(input),
        'INVALID_INPUT_ENVELOPE'
      );
    }

    let createReads = 0;
    const singleReadCreate = Object.defineProperty({}, 'createdAt', {
      enumerable: true,
      get() {
        createReads += 1;
        return createdAt;
      },
    });
    expect(createAflTradeProjectionSchemaBundle(singleReadCreate)).toEqual(createBundle());
    expect(createReads).toBe(1);

    const output = createBundle();
    const reads = new Map<PropertyKey, number>();
    const verifierInput = new Proxy(
      { createdAt, output },
      {
        get(target, property, receiver) {
          reads.set(property, (reads.get(property) ?? 0) + 1);
          return Reflect.get(target, property, receiver);
        },
      }
    );
    expect(verifyAflTradeProjectionSchemaBundleDerivation(verifierInput)).toBe(true);
    expect(reads.get('createdAt')).toBe(1);
    expect(reads.get('output')).toBe(1);

    const revokedVerify = Proxy.revocable({ createdAt, output }, {});
    revokedVerify.revoke();
    expect(verifyAflTradeProjectionSchemaBundleDerivation(revokedVerify.proxy)).toBe(false);
    expect(
      verifyAflTradeProjectionSchemaBundleDerivation({
        createdAt,
        output,
        [Symbol('hostile')]: true,
      })
    ).toBe(false);
  });

  it('deep-freezes results and recognizes only WeakSet-branded construction errors', () => {
    const output = createBundle();
    expect(isDeeplyFrozen(output)).toBe(true);

    const trusted = new AflTradeProjectionSchemaBundleConstructionError('INVALID_CREATED_AT');
    expect(isAflTradeProjectionSchemaBundleConstructionError(trusted)).toBe(true);
    expect(Object.isFrozen(trusted)).toBe(true);
    expect(trusted.toJSON()).toEqual({
      name: 'AflTradeProjectionSchemaBundleConstructionError',
      code: 'INVALID_CREATED_AT',
      message: 'The projection schema-bundle creation time is invalid.',
    });
    expect(Object.isFrozen(trusted.toJSON())).toBe(true);
    expect(isAflTradeProjectionSchemaBundleConstructionError(new Error(trusted.message))).toBe(
      false
    );
    expect(
      isAflTradeProjectionSchemaBundleConstructionError(
        Object.create(AflTradeProjectionSchemaBundleConstructionError.prototype)
      )
    ).toBe(false);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(isAflTradeProjectionSchemaBundleConstructionError(revoked.proxy)).toBe(false);
  });

  it('rejects artifact media, size, content, digest, address, and time tampering', () => {
    const output = createBundle();
    const cases = [
      {
        ...output,
        projectionSchemaBundleArtifactRef: {
          ...output.projectionSchemaBundleArtifactRef,
          mediaType: 'text/plain',
        },
      },
      {
        ...output,
        projectionSchemaBundleArtifactRef: {
          ...output.projectionSchemaBundleArtifactRef,
          byteLength: AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_MAX_BYTES + 1,
        },
      },
      {
        ...output,
        projectionSchemaBundleArtifactRef: {
          ...output.projectionSchemaBundleArtifactRef,
          createdAt: '2026-08-05T04:00:01.000Z',
        },
      },
      {
        ...output,
        projectionSchemaBundle: {
          ...output.projectionSchemaBundle,
          projectionSchemaBundleId: `projection-schema-bundle:${'f'.repeat(64)}`,
        },
      },
    ];

    for (const tampered of cases) {
      expect(aflTradeProjectionSchemaBundleResultSchema.safeParse(tampered).success).toBe(false);
      expect(verifyAflTradeProjectionSchemaBundleDerivation({ createdAt, output: tampered })).toBe(
        false
      );
    }

    const contentTamper = structuredClone(output);
    contentTamper.projectionSchemaBundle.content.descriptorSetSha256 = 'f'.repeat(64);
    expect(
      verifyAflTradeProjectionSchemaBundleDerivation({ createdAt, output: contentTamper })
    ).toBe(false);
  });

  it('states its declarative limitation and excludes user or fantasy ownership', () => {
    const output = createBundle();
    const content = output.projectionSchemaBundle.content;
    expect(content.publicAssetBoundary).toBe(
      AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_PUBLIC_ASSET_BOUNDARY
    );
    expect(content.publicAssetBoundary).toBe(
      'source_native_afl_assets_no_user_or_fantasy_ownership'
    );
    expect(content.limitation).toBe(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_LIMITATION);
    expect(content.limitation).toMatch(/neither resolves artifacts nor executes schemas/i);
    expect(content.limitation).toMatch(/does not authenticate derivations/i);
    expect(content.limitation).toMatch(/validate materialization or stored bytes/i);
    expect(content.limitation).toMatch(/prove parity, source rights, or model validity/i);
    expect(content.limitation).toMatch(/approve or activate publication/i);
    expect(content.limitation).toMatch(/authorize serving or fantasy state/i);

    const keys = collectKeys(output);
    for (const prohibited of [
      'userId',
      'ownerId',
      'fantasyLeagueId',
      'fantasyTeamId',
      'rosterId',
    ]) {
      expect(keys.has(prohibited)).toBe(false);
    }
    expect(
      aflTradeProjectionSchemaBundleContentSchema.safeParse({
        ...content,
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
      }).success
    ).toBe(false);
    expect(AFL_TRADE_PROJECTION_SCHEMA_BUNDLE_DESCRIPTOR_COMPATIBILITY).toBe(
      'exact_version_required_no_implicit_conversion_v1'
    );
  });
});
