import { describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import type { AflTradeImmutableArtifactRepository } from '@/server/aflTradeIntelligence/artifacts/immutableArtifactRepository';
import { createLocalAflTradeHpnMethodAuthority } from '@/server/aflTradeIntelligence/development/localHpnMethodAuthority';
import { createAflTradeHpnPavMethod } from '@/server/aflTradeIntelligence/modeling/hpnPlayerApproximateValue';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';

const bytes = new TextEncoder().encode('<html>Synthetic retained HPN method-source test</html>');
const sourceArtifact = createAflTradeByteArtifactRef(
  bytes,
  'text/html',
  '2026-08-01T00:00:00.000Z'
);
const method = createAflTradeHpnPavMethod({
  sourceArtifact,
  sourceBytes: bytes,
  capturedAt: sourceArtifact.createdAt,
});

function dependencies(
  options: { bytes?: Uint8Array; method?: unknown; absent?: boolean; fixture?: boolean } = {}
) {
  const sql: AflOutcomeSqlClient = {
    async query<Row>() {
      const rows = options.absent ? [] : [{ method_json: options.method ?? method }];
      return { rows: rows as Row[], rowCount: rows.length };
    },
    async transaction(work) {
      return work(sql);
    },
  };
  const artifactRepository: AflTradeImmutableArtifactRepository = {
    assurance: options.fixture ? 'fixture_memory' : 'local_non_production_filesystem',
    artifactClass: 'raw_source',
    custodyProfile: null,
    async loadExact() {
      return { reference: sourceArtifact, bytes: options.bytes ?? bytes };
    },
    async putIfAbsent() {
      throw new Error('Method authority is read-only.');
    },
  };
  return { sql, artifactRepository, maximumArtifactBytes: 1024 };
}

describe('local retained HPN method authority', () => {
  it('loads the selected registered method and verifies its retained HTML bytes', async () => {
    await expect(
      createLocalAflTradeHpnMethodAuthority(dependencies()).loadExact(method.methodId)
    ).resolves.toEqual({ method, sourceBytes: bytes });
  });
  it('rejects tampered retained method-source bytes', async () => {
    await expect(
      createLocalAflTradeHpnMethodAuthority(dependencies({ bytes: new Uint8Array([0]) })).loadExact(
        method.methodId
      )
    ).rejects.toThrow('Retained HPN method source does not match');
  });
  it('does not create an unregistered method or use fixture custody as fallback', async () => {
    await expect(
      createLocalAflTradeHpnMethodAuthority(dependencies({ absent: true })).loadExact(
        method.methodId
      )
    ).rejects.toThrow('Registered non-production HPN method is unavailable');
    expect(() => createLocalAflTradeHpnMethodAuthority(dependencies({ fixture: true }))).toThrow(
      'Local HPN method loading requires non-production artifact custody'
    );
  });
});
