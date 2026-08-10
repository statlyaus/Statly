import { describe, expect, it } from 'vitest';

import {
  createHpnDraftPickValueBenchmark,
  hpnDpv3ValueForPick,
} from '@/server/aflTradeIntelligence/modeling/hpnPickValueBenchmark';

describe('HPN DPVC v3 draft-pick benchmark', () => {
  it('reproduces the published logarithmic curve for picks 1 through 90', () => {
    expect(hpnDpv3ValueForPick(1)).toBeCloseTo(146.95, 10);
    expect(hpnDpv3ValueForPick(14)).toBeCloseTo(-30.36 * Math.log(14) + 146.95, 10);
    expect(hpnDpv3ValueForPick(90)).toBeCloseTo(-30.36 * Math.log(90) + 146.95, 10);
    expect(() => hpnDpv3ValueForPick(0)).toThrow(/1 through 90/);
    expect(() => hpnDpv3ValueForPick(91)).toThrow(/1 through 90/);
  });

  it('seals the exact source evidence and complete supported curve', () => {
    const benchmark = createHpnDraftPickValueBenchmark({
      sourceArtifactId: `artifact:${'a'.repeat(64)}`,
      sourceContentSha256: 'a'.repeat(64),
      capturedAt: '2026-08-09T05:00:00.000Z',
    });

    expect(benchmark.content.curve).toHaveLength(90);
    expect(benchmark.content.curve[13]).toEqual({
      selectionNumber: 14,
      dpvcValue: hpnDpv3ValueForPick(14),
    });
    expect(benchmark.content).toMatchObject({
      sourceUrl: 'https://www.hpnfooty.com/?page_id=22741',
      equation: 'DPVC(p) = -30.36 * ln(p) + 146.95',
      trainingEra: { fromYear: 1993, throughYear: 2006 },
      fatherSonSelections: 'excluded',
      supportedSelectionRange: { from: 1, through: 90 },
      rSquared: 0.73,
      role: 'external_historical_benchmark_not_statly_model',
      publicationEligible: false,
    });
    expect(benchmark.benchmarkId).toMatch(/^hpn-pick-benchmark:[a-f0-9]{64}$/);
  });

  it('rejects source references that do not bind the retained bytes', () => {
    expect(() =>
      createHpnDraftPickValueBenchmark({
        sourceArtifactId: `artifact:${'a'.repeat(64)}`,
        sourceContentSha256: 'b'.repeat(64),
        capturedAt: '2026-08-09T05:00:00.000Z',
      })
    ).toThrow(/source artifact/i);
  });
});
