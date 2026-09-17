import { createAflTradeContentAddress } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import {
  createAflTradeHpnStatisticalCell as cell,
  createAflTradeHpnStatisticalDecision as decision,
  assessAflTradeHpnStatisticalCoverage as coverage,
  aflTradeHpnStatisticalDecisionSchema,
  aflTradeHpnStatisticalCellSchema,
} from '@/server/aflTradeIntelligence/modeling/hpnStatisticalAdjudication';

import { fixture, samples } from '../testUtils/hpnStatisticalAdjudicationFixture';

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
      primary: { ...body.primary, sourceRowSha256: 'b'.repeat(64) },
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
    for (const field of [
      'sourceRowSha256',
      'typedPayloadSha256',
      'stagingSha256',
      'fieldMapSha256',
    ] as const) {
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

describe('review regressions for imported statistical decisions', () => {
  it.each([
    'provider',
    'normalizationRunId',
    'captureId',
    'sourceSnapshotId',
    'sourceArtifactId',
    'providerDecodedRowId',
  ] as const)('rejects shared %s despite other distinct lineage labels', (field) => {
    const { candidateId: _id, ...body } = fixture().candidate;
    body.corroborating[field] = body.primary[field];
    expect(() => cell(body)).toThrow('distinct');
    const imported = {
      ...body,
      candidateId: createAflTradeContentAddress('hpn-statistical-cell', body),
    };
    expect(aflTradeHpnStatisticalCellSchema.safeParse(imported).success).toBe(false);
  });
  it('rejects renamed copies of the same retained row and map bytes', () => {
    const { candidateId: _id, ...body } = fixture().candidate;
    body.corroborating.sourceRowSha256 = body.primary.sourceRowSha256;
    body.corroborating.fieldMapSha256 = body.primary.fieldMapSha256;
    body.corroborating.fieldMapId = body.primary.fieldMapId;
    expect(() => cell(body)).toThrow('distinct');
  });
  it('requires established content-addressed run, snapshot, artifact and map identifiers', () => {
    for (const field of [
      'normalizationRunId',
      'sourceSnapshotId',
      'sourceArtifactId',
      'fieldMapId',
    ] as const) {
      const { candidateId: _id, ...body } = fixture().candidate;
      body.primary[field] = 'free-form-replacement';
      expect(() => cell(body)).toThrow();
    }
  });
  it('canonicalizes factory input but rejects recomputed unordered imports and coverage', () => {
    const f = fixture();
    const evidence = [
      { ...f.input.evidence[0], locator: 'z.CLR' },
      { ...f.input.evidence[0], locator: 'a.CLR' },
    ];
    const forward = decision({ ...f.input, evidence }, f.evidenceBytes);
    const reverse = decision({ ...f.input, evidence: [...evidence].reverse() }, f.evidenceBytes);
    expect(forward).toEqual(reverse);
    expect(evidence.map((item) => item.locator)).toEqual(['z.CLR', 'a.CLR']);
    expect(aflTradeHpnStatisticalDecisionSchema.parse(forward)).toEqual(forward);
    const { decisionId: _id, ...body } = forward;
    body.evidence.reverse();
    const imported = {
      ...body,
      decisionId: createAflTradeContentAddress('hpn-statistical-decision', body),
    };
    expect(aflTradeHpnStatisticalDecisionSchema.safeParse(imported).success).toBe(false);
    expect(() => coverage([f.candidate], [imported])).toThrow('uniquely ordered');
  });
});

it('rejects mismatched field-map identifiers and digests even with a recomputed candidate ID', () => {
  const { candidateId: _id, ...body } = fixture().candidate;
  body.primary.fieldMapSha256 = 'c'.repeat(64);
  expect(() => cell(body)).toThrow('Field-map identifier');
  const imported = {
    ...body,
    candidateId: createAflTradeContentAddress('hpn-statistical-cell', body),
  };
  expect(aflTradeHpnStatisticalCellSchema.safeParse(imported).success).toBe(false);
});

it('rejects copied typed payloads under the same map despite different raw-row hashes', () => {
  const { candidateId: _id, ...body } = fixture().candidate;
  body.corroborating.typedPayloadSha256 = body.primary.typedPayloadSha256;
  body.corroborating.fieldMapSha256 = body.primary.fieldMapSha256;
  body.corroborating.fieldMapId = body.primary.fieldMapId;
  expect(() => cell(body)).toThrow('distinct');
});
