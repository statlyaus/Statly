import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createAflTradeByteArtifactRef,
  createAflTradeCanonicalJsonArtifactRef,
} from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import { createLocalAflTradeNonProductionArtifactRepository } from '@/server/aflTradeIntelligence/development/localFileConditionalObjectStore';
import type { AflOutcomeSqlClient } from '@/server/aflTradeIntelligence/outcomes/postgresOutcomeReleaseRepository';
import {
  planRetainedPlanSuccessor,
  RetainedPlanRefusal,
  retainedTargetFromCapture,
  type RetainedPlanCapture,
  type RetainedPlanTarget,
} from '@/server/aflTradeIntelligence/development/localRetainedPlanSuccessor';
import { createAflTradeRetainedExternalCapturePlan } from '@/server/aflTradeIntelligence/source/externalDraftTradeDiscoveryContracts';
import {
  createLocatedArtifactReader,
  parseBuildRetainedPlanArguments,
} from '../../Scripts/build-retained-plan';

const at = '2026-09-10T00:00:00.000Z';
const plannedAt = '2026-11-21T00:00:00.000Z';
const hex = (value: number) => value.toString(16).padStart(64, '0');
const env = { AFL_OUTCOMES_DATABASE_URL: 'postgresql://localhost:5432/outcomes' };

function target(n: number, year = 2024, createdAt = at): RetainedPlanTarget {
  return {
    captureId: `source-capture:${hex(n)}`,
    evidenceBatchId: `external-evidence-batch:${hex(n)}`,
    executionReceiptId: `external-capture-execution:${hex(n)}`,
    rightsArtifactId: `source-rights:${hex(n)}`,
    gateDecisionId: `gate-decision:${hex(n)}`,
    sourceArtifact: createAflTradeCanonicalJsonArtifactRef({ syntheticSource: n }, createdAt),
    request: {
      environment: 'non_production',
      provider: 'draftguru',
      competition: 'AFLM',
      anchorSeasonYear: year,
      discoveryFromSeasonYear: null,
      draftPathway: 'national',
      dataset: 'Synthetic national selections',
      datasetVersion: 'synthetic/v1',
      accessMechanism: 'automated_web',
      capabilityId: 'draftguru-national-year-page',
      sourceUrl: `https://www.draftguru.com.au/years/${year}`,
      capturedAt: createdAt,
      effectiveAt: `${year}-11-21T00:00:00.000Z`,
      parserVersion: 'synthetic-national/v1',
      fieldManifestSha256: 'f'.repeat(64),
      maximumBytes: 2097152,
    },
  };
}

const capture = (
  value: RetainedPlanTarget,
  batchFinalizedAt = at,
  environment = 'non_production'
): RetainedPlanCapture => ({ target: value, environment, batchFinalizedAt });

const scope = (n: number, createdAt = at) =>
  createAflTradeCanonicalJsonArtifactRef({ syntheticScope: n }, createdAt);

function predecessor(targets: RetainedPlanTarget[]) {
  return createAflTradeRetainedExternalCapturePlan({
    environment: 'non_production',
    competition: 'AFLM',
    plannedAt: '2026-10-01T00:00:00.000Z',
    scopeEvidence: [scope(1)],
    targets,
  });
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof RetainedPlanRefusal) return error.message;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

describe('planRetainedPlanSuccessor', () => {
  const base = predecessor([target(1, 2023), target(2, 2024)]);

  it('replaces the target with equal capability, season and URL in place, and appends the rest', () => {
    const result = planRetainedPlanSuccessor({
      predecessor: base,
      captures: [capture(target(3, 2024)), capture(target(4, 2025))],
      scopeEvidence: [scope(2)],
      plannedAt,
    });
    expect(result.kept).toBe(1);
    expect(result.replaced).toEqual([
      {
        capabilityId: 'draftguru-national-year-page',
        anchorSeasonYear: 2024,
        sourceUrl: 'https://www.draftguru.com.au/years/2024',
        previousCaptureId: target(2).captureId,
        captureId: target(3).captureId,
      },
    ]);
    expect(
      result.added.map((change) => [change.anchorSeasonYear, change.previousCaptureId])
    ).toEqual([[2025, null]]);
    expect(result.plan.content.targets.map((t) => t.content.captureId)).toEqual([
      target(1).captureId,
      target(3).captureId,
      target(4).captureId,
    ]);
    expect(result.plan.content.plannedAt).toBe(plannedAt);
    expect(result.plan.content.throughYear).toBe(2025);
    expect(result.plan.content.scopeEvidence.map((ref) => ref.artifactId).sort()).toEqual(
      [scope(1).artifactId, scope(2).artifactId].sort()
    );
  });

  it('keeps every predecessor target it is not given a capture for, byte for byte', () => {
    const result = planRetainedPlanSuccessor({
      predecessor: base,
      captures: [capture(target(5, 2022))],
      scopeEvidence: [],
      plannedAt,
    });
    expect(result.plan.content.targets.slice(0, 2)).toEqual(base.content.targets);
  });

  it('refuses a capture that matches more than one target', () => {
    const ambiguous = predecessor([target(1, 2024), { ...target(2, 2024) }]);
    expect(
      refusal(() =>
        planRetainedPlanSuccessor({
          predecessor: ambiguous,
          captures: [capture(target(3, 2024))],
          scopeEvidence: [],
          plannedAt,
        })
      )
    ).toMatch(/matches more than one target/);
  });

  it('refuses duplicate captures, batches and two captures of one page', () => {
    const run = (captures: RetainedPlanCapture[]) =>
      refusal(() =>
        planRetainedPlanSuccessor({ predecessor: base, captures, scopeEvidence: [], plannedAt })
      );
    expect(run([capture(target(3)), capture(target(3))])).toMatch(/given twice/);
    expect(run([capture(target(1, 2023))])).toMatch(/already in the plan/);
    expect(run([capture({ ...target(3), evidenceBatchId: target(1).evidenceBatchId })])).toMatch(
      /Evidence batch .* already in the plan/
    );
    expect(run([capture(target(3, 2025)), capture(target(4, 2025))])).toMatch(
      /re-capture the same page/
    );
    expect(run([])).toMatch(/at least one capture/);
  });

  it('refuses a capture, batch, artifact or scope evidence created after plannedAt', () => {
    const later = '2026-11-21T00:00:00.001Z';
    const run = (captures: RetainedPlanCapture[], scopeEvidence = [scope(2)]) =>
      refusal(() =>
        planRetainedPlanSuccessor({ predecessor: base, captures, scopeEvidence, plannedAt })
      );
    expect(run([capture(target(3), later)])).toMatch(/created after plannedAt/);
    expect(run([capture(target(3, 2024, later))])).toMatch(/created after plannedAt/);
    expect(run([capture(target(3))], [scope(2, later)])).toMatch(
      /Scope evidence .* after plannedAt/
    );
    expect(run([capture(target(3))], [scope(1)])).toMatch(/already carried/);
    expect(run([capture(target(3), at, 'test_fixture')])).toMatch(/is test_fixture/);
  });

  it('refuses a capture outside its reviewed capture scope', () => {
    // A 2024 capture of the 2023 year page.
    const page = target(3);
    const mismatched = {
      ...page,
      request: { ...page.request, sourceUrl: 'https://www.draftguru.com.au/years/2023' },
    };
    expect(
      refusal(() =>
        planRetainedPlanSuccessor({
          predecessor: base,
          captures: [capture(mismatched)],
          scopeEvidence: [],
          plannedAt,
        })
      )
    ).toMatch(new RegExp(`${target(3).captureId} is outside its reviewed capture scope`));
  });
});

describe('createLocatedArtifactReader', () => {
  it('reads an artifact located in a nested repository of the store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'statly-retained-plan-reader-'));
    try {
      const repositoryPath = 'fitzroy-historical/fitzroy-historical-raw';
      const bytes = new TextEncoder().encode('<html>synthetic retained page</html>');
      const reference = createAflTradeByteArtifactRef(bytes, 'text/html', at);
      await createLocalAflTradeNonProductionArtifactRepository({
        rootDirectory: root,
        repositoryId: repositoryPath,
        artifactClass: 'raw_source',
        maximumObjectBytes: 2097152,
      }).putIfAbsent(reference, bytes);
      const sha = reference.contentSha256;
      const located = (objectKey: string): AflOutcomeSqlClient => ({
        query: async <Row>() => ({
          rows: [
            {
              object_key: objectKey,
              artifact_class: 'raw_source',
              root_locator: root,
              assurance: 'local_non_production_filesystem',
              environment: 'non_production',
            },
          ] as unknown as Row[],
          rowCount: 1,
        }),
        transaction: async () => {
          throw new Error('The reader never writes.');
        },
      });
      const key = `local_non_production_filesystem/sha256/${sha.slice(0, 2)}/${sha.slice(2, 4)}/${sha}`;
      const read = await createLocatedArtifactReader(located(`${repositoryPath}/${key}`)).read(
        reference
      );
      expect(Array.from(read)).toEqual(Array.from(bytes));
      // An older object can be stored under a createdAt other than the one its citation records
      // (genuine 2026-11-21): the reader still returns its bytes, which the plan checks by hash.
      const laterCitation = { ...reference, createdAt: '2026-10-01T00:00:00.000Z' };
      expect(
        Array.from(
          await createLocatedArtifactReader(located(`${repositoryPath}/${key}`)).read(laterCitation)
        )
      ).toEqual(Array.from(bytes));
      await expect(
        createLocatedArtifactReader(located(`fitzroy-historical/${key}`)).read(reference)
      ).rejects.toThrow(/bytes are missing/);
      await expect(
        createLocatedArtifactReader(
          located(`${repositoryPath}/${key.replace(sha, 'f'.repeat(64))}`)
        ).read(reference)
      ).rejects.toThrow(/unexpected key/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('retainedTargetFromCapture', () => {
  it('refuses a capture with no captured v2 execution receipt', () => {
    expect(
      refusal(() =>
        retainedTargetFromCapture({
          captureId: target(1).captureId,
          evidenceBatchId: target(1).evidenceBatchId,
          manifest: { artifact: target(1).sourceArtifact, executionReceipt: { receiptId: 'x' } },
        })
      )
    ).toMatch(/no captured v2 execution receipt/);
  });
});

describe('parseBuildRetainedPlanArguments', () => {
  const candidate = `external-reconciliation:${hex(9)}`;

  it('reads one capture list inline or from a file, dry run by default', () => {
    const inline = parseBuildRetainedPlanArguments(
      [
        '--from-candidate',
        candidate,
        '--captures',
        `${target(1).captureId},${target(2).captureId}`,
      ],
      env
    );
    expect(inline.request).toEqual({
      candidateId: candidate,
      captureIds: [target(1).captureId, target(2).captureId],
      scopeEvidenceIds: [],
      apply: false,
    });
    const fromFile = parseBuildRetainedPlanArguments(
      [
        '--from-candidate',
        candidate,
        '--captures-file',
        'ids.txt',
        '--scope-evidence',
        scope(1).artifactId,
        '--apply',
      ],
      env,
      () => `${target(1).captureId}\n${target(2).captureId}\n`
    );
    expect(fromFile.request.captureIds).toHaveLength(2);
    expect(fromFile.request.scopeEvidenceIds).toEqual([scope(1).artifactId]);
    expect(fromFile.request.apply).toBe(true);
  });

  it('refuses a missing or doubled capture list, malformed IDs and a remote database', () => {
    const captures = ['--captures', target(1).captureId];
    expect(() => parseBuildRetainedPlanArguments(['--from-candidate', candidate], env)).toThrow(
      /exactly one of --captures/
    );
    expect(() =>
      parseBuildRetainedPlanArguments(
        ['--from-candidate', candidate, ...captures, '--captures-file', 'ids.txt'],
        env
      )
    ).toThrow(/exactly one of --captures/);
    expect(() =>
      parseBuildRetainedPlanArguments(['--from-candidate', 'nope', ...captures], env)
    ).toThrow(/candidate ID/);
    expect(() =>
      parseBuildRetainedPlanArguments(
        ['--from-candidate', candidate, '--captures', 'source-capture:nope'],
        env
      )
    ).toThrow(/malformed ID/);
    expect(() =>
      parseBuildRetainedPlanArguments(['--from-candidate', candidate, ...captures], {
        AFL_OUTCOMES_DATABASE_URL: 'postgresql://db.example.com/outcomes',
      })
    ).toThrow(/loopback/);
  });
});
