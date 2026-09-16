import { createAflTradeByteArtifactRef } from '@/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  createAflTradeHpnStatisticalCell as cell,
  createAflTradeHpnStatisticalDecision as decision,
  assessAflTradeHpnStatisticalCoverage as coverage,
  aflTradeHpnStatisticalDecisionSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnStatisticalAdjudication';

// Observed sample values; all identities and evidence bytes below are synthetic test fixtures.
const samples = [
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
function fixture(index = 0) {
  const [playerId, primary, corroborating] = samples[index];
  const observation = {
    normalizationRunId: 'primary-run',
    normalizationRunSha256: digest,
    decodedRowId: `row-${playerId}`,
    decodedRowSha256: digest,
    fieldMapId: 'map-v1',
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
      normalizationRunId: 'secondary-run',
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

describe('HPN statistical adjudication contracts', () => {
  it.each(samples.map((sample, index) => [sample[0], index] as const))(
    'retains both alternatives for %s',
    (_, index) => {
      const f = fixture(index);
      expect(f.result.selectedValue).toBe(samples[index][1]);
      expect(f.result.candidate.corroborating.value).toBe(samples[index][2]);
      expect(f.result.authority).toBe('requires_repository_verification');
    }
  );
  it('reports exact coverage without granting calculation authority and replays deterministically', () => {
    const fixtures = samples.map((_, index) => fixture(index));
    const cells = fixtures.map((f) => f.candidate);
    const decisions = fixtures.map((f) => f.result);
    const complete = coverage(cells, decisions);
    expect(complete.status).toBe('coverage_complete');
    expect(complete.calculationEligible).toBe(false);
    expect(coverage([...cells].reverse(), [...decisions].reverse())).toEqual(complete);
    expect(coverage(cells, decisions.slice(1)).missingCandidateIds).toEqual([cells[0].candidateId]);
    expect(coverage(cells, []).status).toBe('incomplete');
  });
  it('rejects extra decisions and conflicting or duplicate cells', () => {
    const a = fixture(0);
    const b = fixture(1);
    expect(() => coverage([a.candidate], [b.result])).toThrow('Extra');
    expect(() => coverage([a.candidate], [a.result, a.result])).toThrow('conflicting');
    expect(() => coverage([a.candidate, a.candidate], [])).toThrow('Duplicate');
    expect(() => coverage([], [])).toThrow('universe');
    const { candidateId: _id, ...body } = a.candidate;
    const changed = cell({
      ...body,
      primary: { ...body.primary, decodedRowSha256: 'b'.repeat(64) },
    });
    expect(() => coverage([a.candidate, changed], [])).toThrow('Duplicate');
  });
  it('rejects neither-source corrections and unsupported evidence', () => {
    const f = fixture();
    expect(() => decision({ ...f.input, selectedValue: 99 }, f.evidenceBytes)).toThrow();
    expect(() =>
      decision({ ...f.input, selectedSource: 'corroborating' }, f.evidenceBytes)
    ).toThrow();
    expect(() => decision(f.input, new Map())).toThrow('evidence bytes');
    expect(() =>
      decision(f.input, new Map([[f.input.evidence[0].artifact.artifactId, new Uint8Array([1])]]))
    ).toThrow('evidence bytes');
  });
  it('detects modified source hashes, identities and values on replay', () => {
    const f = fixture();
    for (const field of ['decodedRowSha256', 'normalizationRunSha256', 'fieldMapSha256'] as const) {
      const altered = structuredClone(f.result);
      altered.candidate.primary[field] = 'b'.repeat(64);
      expect(aflTradeHpnStatisticalDecisionSchema.safeParse(altered).success).toBe(false);
    }
    const altered = structuredClone(f.result);
    altered.candidate.scope.playerId = 'other-player';
    expect(() => coverage([f.candidate], [altered])).toThrow();
    altered.candidate.primary.value = 9;
    expect(aflTradeHpnStatisticalDecisionSchema.safeParse(altered).success).toBe(false);
  });
  it('retains blank provenance and requires measured zero evidence', () => {
    const f = fixture(5);
    expect(f.result.candidate.primary.representation).toBe('blank_normalized_zero');
    expect(f.result.evidence[0].observedValue).toBe(0);
    expect(() => decision({ ...f.input, evidence: [] }, f.evidenceBytes)).toThrow();
    const { candidateId: _id, ...body } = f.candidate;
    expect(() => cell({ ...body, primary: { ...body.primary, value: 1 } })).toThrow();
  });
  it('rejects mixed seasons, premature decisions and future evidence', () => {
    const a = fixture();
    const b = fixture(1);
    const { candidateId: _id, ...body } = b.candidate;
    const later = cell({ ...body, scope: { ...body.scope, season: 2019 } });
    expect(() => coverage([a.candidate, later], [])).toThrow('Cross');
    expect(() =>
      decision({ ...a.input, decidedAt: '2026-09-15T00:00:00Z' }, a.evidenceBytes)
    ).toThrow();
    expect(() =>
      decision(
        {
          ...a.input,
          evidence: [
            {
              ...a.input.evidence[0],
              artifact: {
                ...a.input.evidence[0].artifact,
                createdAt: '2026-09-17T00:00:00Z',
              },
            },
          ],
        },
        a.evidenceBytes
      )
    ).toThrow();
  });
  it('binds supersession without pretending to authenticate current heads', () => {
    const f = fixture();
    const replacement = decision(
      {
        ...f.input,
        supersedesDecisionId: f.result.decisionId,
        rationale: 'Replacement fixture review.',
      },
      f.evidenceBytes
    );
    expect(() => coverage([f.candidate], [f.result, replacement])).toThrow();
    expect(coverage([f.candidate], [replacement]).authority).toBe(
      'requires_repository_verification'
    );
  });
});
