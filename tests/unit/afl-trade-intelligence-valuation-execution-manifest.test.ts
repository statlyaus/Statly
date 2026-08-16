import { describe, expect, it } from 'vitest';

import { createHash } from 'node:crypto';

import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  AFL_TRADE_VALUATION_EXECUTION_MANIFEST_SCHEMA_VERSION,
  aflTradeValuationExecutionManifestSchema,
} from '@/server/aflTradeIntelligence/artifacts/valuationExecutionManifest';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const artifact = (name: string, createdAt: string) => ({
  artifactId: `artifact:${digest(`${name}-bytes`)}`,
  contentSha256: digest(`${name}-bytes`),
  storageUri: `artifact://sha256/${digest(`${name}-bytes`)}`,
  mediaType: 'application/json',
  byteLength: 512,
  createdAt,
});

const createManifest = () => {
  const content = {
    schemaVersion: AFL_TRADE_VALUATION_EXECUTION_MANIFEST_SCHEMA_VERSION,
    environment: 'non_production' as const,
    scopeKey: 'afl-men:2025-trades',
    valuationInputBundleId: `valuation-input-bundle:${digest('stable-input-bundle')}`,
    valuationInputBundleArtifact: artifact('input-bundle', '2026-08-15T00:00:00.000Z'),
    preparedInputSetId: `prepared-valuation-input-set:${digest('prepared-input-set')}`,
    preparedInputSetArtifact: artifact('prepared-input-set', '2026-08-15T00:01:00.000Z'),
    execution: {
      executorVersion: 'valuation-construction:v1',
      codeCommitSha: '7'.repeat(40),
      cleanWorktree: true as const,
      jobId: 'valuation-job-2025-local',
      attempt: 1,
      initiatedBy: 'local-rehearsal-operator',
      workerIdentity: 'local-disposable-worker',
      startedAt: '2026-08-15T00:02:00.000Z',
      finishedAt: '2026-08-15T00:03:00.000Z',
      executionLogArtifact: artifact('execution-log', '2026-08-15T00:03:00.000Z'),
    },
    outputs: {
      outputInventoryRootArtifact: artifact('output-inventory', '2026-08-15T00:03:00.000Z'),
      validationReportArtifact: artifact('validation-report', '2026-08-15T00:03:00.000Z'),
      coverageAndExclusionReportArtifact: artifact(
        'coverage-exclusion-report',
        '2026-08-15T00:03:00.000Z'
      ),
      modelCardArtifact: artifact('model-card', '2026-08-15T00:03:00.000Z'),
    },
    createdAt: '2026-08-15T00:04:00.000Z',
    publicationEligible: false as const,
    limitation:
      'Execution and output custody only; not numerical validity, publication approval, or activation authority.' as const,
  };

  return {
    valuationExecutionId: createAflTradeContentAddress('valuation-execution', content),
    content,
  };
};

describe('AFL trade valuation execution manifest', () => {
  it('binds post-execution custody to one immutable pre-execution bundle and prepared set', () => {
    const manifest = aflTradeValuationExecutionManifestSchema.parse(createManifest());

    expect(manifest.content.valuationInputBundleId).toContain('valuation-input-bundle:');
    expect(manifest.content.preparedInputSetId).toContain('prepared-valuation-input-set:');
    expect(manifest.content).not.toHaveProperty('factualReleaseActivation');
    expect(manifest.content).not.toHaveProperty('publicationApproval');
  });

  it('rejects output custody that claims to predate execution', () => {
    const manifest = createManifest();
    manifest.content.outputs.outputInventoryRootArtifact.createdAt = '2026-08-15T00:01:00.000Z';
    manifest.valuationExecutionId = createAflTradeContentAddress(
      'valuation-execution',
      manifest.content
    );

    expect(() => aflTradeValuationExecutionManifestSchema.parse(manifest)).toThrow(
      'Output artifacts cannot predate execution start.'
    );
  });

  it('is non-production-only in the local rehearsal contract', () => {
    const manifest = createManifest();
    const content = { ...manifest.content, environment: 'production' as const };
    expect(() =>
      aflTradeValuationExecutionManifestSchema.parse({
        valuationExecutionId: createAflTradeContentAddress('valuation-execution', content),
        content,
      })
    ).toThrow();
  });
});
