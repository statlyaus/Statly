import { describe, expect, it } from 'vitest';

import {
  failAflTradeCalculationAttempt,
  queueAflTradeCalculationRun,
  startAflTradeCalculationAttempt,
  succeedAflTradeCalculationAttempt,
} from '@/server/aflTradeIntelligence/operations/calculationRunState';
import type { AflTradeCalculationRunInputs } from '@/server/aflTradeIntelligence/operations/calculationRunContracts';
import {
  aflTradeOperationalHealthInputSchema,
  evaluateAflTradeOperationalHealth,
  type AflTradeOperationalHealthInput,
} from '@/server/aflTradeIntelligence/operations/operationalHealth';

const digest = (character: string) => character.repeat(64);

function artifact(character: string, createdAt = '2026-08-05T01:00:00.000Z') {
  const contentSha256 = digest(character);
  return {
    artifactId: `artifact:${contentSha256}`,
    contentSha256,
    storageUri: `artifact://sha256/${contentSha256}`,
    mediaType: 'application/json',
    byteLength: 128,
    createdAt,
  };
}

function runInputs(): AflTradeCalculationRunInputs {
  return {
    schemaVersion: 'afl-trade-calculation-inputs/v1',
    environment: 'non_production',
    scopeKey: 'public-afl-trades-current',
    calculationAsOf: '2026-08-05T03:00:00.000Z',
    knowledgeCutoffAt: '2026-08-05T02:00:00.000Z',
    valuationBundleId: `valuation-bundle:${digest('a')}`,
    datasetIds: [`dataset:${digest('b')}`],
    evidenceManifestIds: [`evidence-manifest:${digest('c')}`],
    sourceRegisterIds: ['fixture-public-source'],
    requestedViews: ['current'],
    codeCommitSha: 'd'.repeat(40),
    configurationArtifact: artifact('e'),
  };
}

function queuedRun() {
  return queueAflTradeCalculationRun({
    inputs: runInputs(),
    lastGoodAtStart: {
      scopeKey: 'public-afl-trades-current',
      publicationId: `publication:${digest('f')}`,
      projectionId: `projection:${digest('1')}`,
      registryRevision: 7,
      activatedAt: '2026-08-04T00:00:00.000Z',
      capturedAt: '2026-08-05T00:00:00.000Z',
    },
    queuedAt: '2026-08-05T03:05:00.000Z',
    initiatedBy: 'fixture-scheduler',
  });
}

function runningRun() {
  const queued = queuedRun();
  return startAflTradeCalculationAttempt(queued, {
    expectedAttemptId: queued.attempts[0].attemptId,
    workerIdentity: 'fixture-worker',
    leaseId: 'fixture-lease',
    startedAt: '2026-08-05T03:06:00.000Z',
    leaseExpiresAt: '2026-08-05T03:16:00.000Z',
  });
}

function failedRun(retryable = true) {
  const running = runningRun();
  return failAflTradeCalculationAttempt(running, {
    expectedAttemptId: running.attempts[0].attemptId,
    expectedLeaseId: 'fixture-lease',
    finishedAt: '2026-08-05T03:08:00.000Z',
    result: {
      classification: 'projection_failure',
      retryable,
      reasonCode: 'fixture-projection-failure',
      message: 'The fabricated projection failed.',
      diagnosticsArtifact: artifact('2', '2026-08-05T03:08:00.000Z'),
    },
  });
}

function succeededRun() {
  const running = runningRun();
  return succeedAflTradeCalculationAttempt(running, {
    expectedAttemptId: running.attempts[0].attemptId,
    expectedLeaseId: 'fixture-lease',
    finishedAt: '2026-08-05T03:08:00.000Z',
    result: {
      publicationId: `publication:${digest('3')}`,
      projectionId: `projection:${digest('4')}`,
      publicationManifestArtifact: artifact('5', '2026-08-05T03:08:00.000Z'),
      projectionManifestArtifact: artifact('6', '2026-08-05T03:08:00.000Z'),
      diagnosticsArtifact: artifact('7', '2026-08-05T03:08:00.000Z'),
    },
  });
}

function healthInput(): AflTradeOperationalHealthInput {
  const publicationId = `publication:${digest('8')}`;
  const projectionId = `projection:${digest('9')}`;
  return {
    schemaVersion: 'afl-trade-operational-health-input/v1',
    environment: 'non_production',
    scopeKey: 'public-afl-trades-current',
    evaluatedAt: '2026-08-05T04:00:00.000Z',
    sourceRights: {
      status: 'approved',
      checkedAt: '2026-08-05T03:50:00.000Z',
      evidenceId: 'fixture-rights-check',
    },
    activePublication: {
      publicationId,
      projectionId,
      registryRevision: 8,
      activatedAt: '2026-08-05T03:30:00.000Z',
      dataAsOf: '2026-08-05T03:00:00.000Z',
    },
    activeProjectionCheck: {
      publicationId,
      projectionId,
      status: 'healthy',
      checkedAt: '2026-08-05T03:55:00.000Z',
      evidenceId: 'fixture-projection-check',
    },
    latestRun: null,
    thresholds: {
      maximumPublicationAgeSeconds: 7_200,
      maximumRunSilenceSeconds: 600,
      maximumSourceEvidenceAgeSeconds: 3_600,
      maximumProjectionCheckAgeSeconds: 900,
    },
  };
}

describe('AFL trade-intelligence operational health', () => {
  it('serves a current, verified publication without alerts', () => {
    const snapshot = evaluateAflTradeOperationalHealth(healthInput());

    expect(snapshot.state).toBe('healthy');
    expect(snapshot.publicationRecommendation).toBe('serve_active');
    expect(snapshot.calculationRecommendation).toBe('none');
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.healthSnapshotId).toMatch(/^health-snapshot:[a-f0-9]{64}$/);
  });

  it('retains last-good and recommends a controlled retry after a retryable failure', () => {
    const snapshot = evaluateAflTradeOperationalHealth({
      ...healthInput(),
      latestRun: failedRun(),
    });

    expect(snapshot.state).toBe('degraded');
    expect(snapshot.publicationRecommendation).toBe('retain_last_good');
    expect(snapshot.retainedPublicationId).toBe(healthInput().activePublication?.publicationId);
    expect(snapshot.calculationRecommendation).toBe('retry');
    expect(snapshot.alerts.map((alert) => alert.code)).toContain('calculation_failed_retryable');
  });

  it('makes source-rights loss override last-good and retry recommendations', () => {
    const snapshot = evaluateAflTradeOperationalHealth({
      ...healthInput(),
      sourceRights: {
        status: 'withdrawn',
        checkedAt: '2026-08-05T03:58:00.000Z',
        evidenceId: 'fixture-rights-withdrawal',
      },
      latestRun: failedRun(),
    });

    expect(snapshot.state).toBe('critical');
    expect(snapshot.publicationRecommendation).toBe('withdraw_active');
    expect(snapshot.calculationRecommendation).toBe('stop_new_work');
    expect(snapshot.retainedPublicationId).toBeNull();
  });

  it('distinguishes projection corruption from transient unavailability', () => {
    const input = healthInput();
    const corrupt = evaluateAflTradeOperationalHealth({
      ...input,
      activeProjectionCheck: { ...input.activeProjectionCheck!, status: 'integrity_failed' },
      latestRun: failedRun(),
    });
    const unavailable = evaluateAflTradeOperationalHealth({
      ...input,
      activeProjectionCheck: { ...input.activeProjectionCheck!, status: 'unavailable' },
    });

    expect(corrupt.publicationRecommendation).toBe('withdraw_active');
    expect(corrupt.calculationRecommendation).toBe('investigate');
    expect(unavailable.publicationRecommendation).toBe('suppress_numbers');
    expect(unavailable.activePublicationId).toBe(input.activePublication?.publicationId);
  });

  it('fails closed when source or projection verification evidence becomes stale', () => {
    const input = healthInput();
    const staleSource = evaluateAflTradeOperationalHealth({
      ...input,
      sourceRights: { ...input.sourceRights, checkedAt: '2026-08-05T02:00:00.000Z' },
    });
    const staleProjection = evaluateAflTradeOperationalHealth({
      ...input,
      activeProjectionCheck: {
        ...input.activeProjectionCheck!,
        checkedAt: '2026-08-05T03:40:00.000Z',
      },
    });

    expect(staleSource.publicationRecommendation).toBe('withdraw_active');
    expect(staleSource.calculationRecommendation).toBe('stop_new_work');
    expect(staleSource.alerts[0].code).toBe('source_rights_evidence_stale');
    expect(staleProjection.publicationRecommendation).toBe('suppress_numbers');
    expect(staleProjection.calculationRecommendation).toBe('investigate');
    expect(staleProjection.alerts[0].code).toBe('active_projection_check_stale');
  });

  it('marks stale publications and stalled runs without replacing authority', () => {
    const input = healthInput();
    const snapshot = evaluateAflTradeOperationalHealth({
      ...input,
      activePublication: { ...input.activePublication!, dataAsOf: '2026-08-05T00:00:00.000Z' },
      latestRun: queuedRun(),
    });

    expect(snapshot.state).toBe('degraded');
    expect(snapshot.publicationRecommendation).toBe('serve_active_with_warning');
    expect(snapshot.calculationRecommendation).toBe('investigate');
    expect(snapshot.alerts.map((alert) => alert.code)).toEqual([
      'active_publication_stale',
      'calculation_attempt_stalled',
    ]);
  });

  it('keeps successful calculation output non-serving pending governance', () => {
    const input = healthInput();
    const snapshot = evaluateAflTradeOperationalHealth({
      ...input,
      activePublication: null,
      activeProjectionCheck: null,
      latestRun: succeededRun(),
    });

    expect(snapshot.state).toBe('blocked');
    expect(snapshot.publicationRecommendation).toBe('suppress_numbers');
    expect(snapshot.candidatePublicationId).toBe(succeededRun().candidatePublicationId);
    expect(snapshot.alerts.map((alert) => alert.code)).toEqual([
      'no_active_publication',
      'candidate_awaiting_governance',
    ]);
  });

  it('rejects mismatched projection evidence and fantasy ownership fields', () => {
    const input = healthInput();
    expect(
      aflTradeOperationalHealthInputSchema.safeParse({
        ...input,
        activeProjectionCheck: {
          ...input.activeProjectionCheck!,
          projectionId: `projection:${digest('0')}`,
        },
      }).success
    ).toBe(false);
    expect(
      aflTradeOperationalHealthInputSchema.safeParse({
        ...input,
        userId: 'fixture-user',
        fantasyLeagueId: 'fixture-league',
      }).success
    ).toBe(false);
  });
});
