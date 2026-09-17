import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeHpnStatisticalCell as cell,
  createAflTradeHpnStatisticalDecision as decision,
} from '@/server/aflTradeIntelligence/modeling/hpnStatisticalAdjudication';

// Observed sample values; all identities and evidence bytes below are synthetic test fixtures.
export const samples = [
  ['Young', 1, 2],
  ['Kolodjashnij', 1, 0],
  ['Ziebell', 3, 2],
  ['Macmillan', 1, 0],
  ['McDonald', 4, 3],
  ['Hartung', 0, 1],
  ['Griffen', 2, 1],
  ['Taranto', 4, 6],
  ['Whitfield', 3, 5],
  ['Beams', 3, 2],
] as const;
const createdAt = '2026-09-16T01:00:00.000Z';
const decidedAt = '2026-09-16T02:00:00.000Z';
const digest = 'a'.repeat(64);
export function fixture(index = 0) {
  const [playerId, primary, corroborating] = samples[index];
  const observation = {
    normalizationRunId: `provider-normalization-run:${digest}`,
    stagingSha256: digest,
    provider: 'afl-tables',
    capabilityId: 'afl-tables-player-stats',
    captureId: 'primary-capture',
    sourceSnapshotId: `source-snapshot:${digest}`,
    sourceArtifactId: `artifact:${digest}`,
    providerDecodedRowId: `row-${playerId}`,
    sourceRowSha256: digest,
    typedPayloadSha256: digest,
    fieldMapId: `hpn-pav-field-map:${digest}`,
    fieldMapSha256: digest,
    sourceFields: ['Clearances'],
    value: primary,
    representation: index === 5 ? ('blank_normalized_zero' as const) : ('measured' as const),
  };
  const candidate = cell({
    schemaVersion: 'afl-trade-hpn-statistical-cell/v1',
    scope: {
      environment: 'non_production',
      competitionId: 'afl',
      season: 2018,
      playerId,
      matchId: index < 6 ? 'fixture-1474' : 'fixture-1547',
      clubId: 'synthetic-club',
      statistic: 'clearances',
    },
    primary: observation,
    corroborating: {
      ...observation,
      normalizationRunId: `provider-normalization-run:${'b'.repeat(64)}`,
      stagingSha256: 'b'.repeat(64),
      provider: 'footywire',
      capabilityId: 'footywire-player-stats',
      captureId: 'secondary-capture',
      sourceSnapshotId: `source-snapshot:${'b'.repeat(64)}`,
      sourceArtifactId: `artifact:${'b'.repeat(64)}`,
      providerDecodedRowId: `secondary-row-${playerId}`,
      sourceRowSha256: 'b'.repeat(64),
      typedPayloadSha256: 'b'.repeat(64),
      fieldMapId: `hpn-pav-field-map:${'b'.repeat(64)}`,
      fieldMapSha256: 'b'.repeat(64),
      value: corroborating,
      representation: 'measured',
    },
    createdAt,
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ playerId, CLR: primary }));
  const artifact = createAflTradeByteArtifactRef(bytes, 'application/json', createdAt);
  const input = {
    schemaVersion: 'afl-trade-hpn-statistical-decision/v1' as const,
    candidate,
    selectedSource: 'primary' as const,
    selectedValue: primary,
    evidence: [
      {
        artifact,
        locator: `${playerId}.CLR`,
        observedValue: primary,
        representation: 'measured' as const,
      },
    ],
    reviewerId: 'synthetic-reviewer',
    rationale: 'Fixture explicit CLR supports selected retained value.',
    decidedAt,
    supersedesDecisionId: null,
    authority: 'requires_repository_verification' as const,
    publicationEligible: false as const,
  };
  const evidenceBytes = new Map([[artifact.artifactId, bytes]]);
  return { candidate, input, evidenceBytes, result: decision(input, evidenceBytes) };
}
