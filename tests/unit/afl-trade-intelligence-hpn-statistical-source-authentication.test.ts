import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256AflTradeCanonicalJson } from '@/server/aflTradeIntelligence/artifacts/contentAddress';
import { createAflTradeHpnStatisticalCell } from '@/server/aflTradeIntelligence/modeling/hpnStatisticalAdjudication';
import { authenticateAflTradeHpnStatisticalSources } from '@/server/aflTradeIntelligence/modeling/postgresHpnStatisticalSourceAuthentication';
import { setup } from '../testUtils/hpnStatisticalSourceFixture';
afterEach(() => vi.restoreAllMocks());

describe('HPN retained source authentication', () => {
  it.each(['clearances', 'totalPoints'])(
    'authenticates staged projected %s through exact source authority',
    async (statistic) => {
      const f = setup(statistic, true);
      expect(await authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).toMatchObject({
        status: 'retained_sources_match',
      });
      expect(f.statements.filter((sql) => sql.includes('AS staged_source_authority'))).toHaveLength(
        2
      );
    }
  );
  it('rejects a projected map created after the candidate', async () => {
    const f = setup('clearances', true, '2026-09-16T02:00:00.000Z');
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'exact retained'
    );
  });
  it('rejects staged source authority withdrawal', async () => {
    const f = setup('clearances', true);
    f.state.stagedAuthority = false;
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'exact clean reviewed source'
    );
  });

  it.each(['clearances', 'totalPoints'])(
    'authenticates %s without granting decision authority',
    async (statistic) => {
      const f = setup(statistic);
      expect(await authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).toMatchObject({
        candidateId: f.cell.candidateId,
        status: 'retained_sources_match',
        calculationEligible: false,
        publicationEligible: false,
      });
      expect(
        f.statements.find((sql) => sql.includes('FROM outcome_provider_decoded_row'))
      ).toContain('FOR SHARE');
    }
  );
  it.each([
    'staging_sha256',
    'source_artifact_id',
    'capture_id',
    'source_snapshot_id',
    'capture_provider',
    'capture_capability_id',
  ])('rejects retained run drift: %s', async (field) => {
    const f = setup();
    Object.assign(f.state.runs[0], { [field]: 'changed' });
    await expect(
      authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)
    ).rejects.toThrow();
  });
  it.each([
    { season_year: 2019 },
    { competition: 'other' },
    { row_status: 'quarantined' },
    { normalization_run_id: 'wrong-run' },
    { source_row_sha256: 'f'.repeat(64) },
    { recorded_at: '2026-09-16T02:00:00Z' },
    { capture_id: 'wrong-capture' },
  ])('rejects retained row drift: %j', async (change) => {
    const f = setup();
    Object.assign(f.state.rows[0], change);
    await expect(
      authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)
    ).rejects.toThrow();
  });
  it('rejects missing source rows and superseded map approval', async () => {
    const f = setup();
    f.state.rows.pop();
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'Both exact'
    );
    f.state.currentApproval = false;
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'superseded'
    );
  });
  it('rejects changed values and source field substitution even with valid candidate hashes', async () => {
    const f = setup();
    for (const change of [{ value: 99 }, { sourceFields: ['Tackles'] }]) {
      const { candidateId: _id, ...body } = f.cell;
      const candidate = createAflTradeHpnStatisticalCell({
        ...body,
        primary: { ...body.primary, ...change },
      });
      await expect(
        authenticateAflTradeHpnStatisticalSources(f.transaction, candidate)
      ).rejects.toThrow('reviewed fields or retained value');
    }
  });
  it.each([
    { kind: 'missing' },
    { kind: 'integer', value: '9007199254740992' },
    { kind: 'integer', value: '-1' },
  ])('rejects missing or unsafe retained scalars: %j', async (scalar) => {
    const f = setup();
    Object.assign(f.state.rows[0].typed_payload.values, { Clearances: scalar });
    const { candidateId: _id, ...body } = f.cell;
    const candidate = createAflTradeHpnStatisticalCell({
      ...body,
      primary: {
        ...body.primary,
        typedPayloadSha256: sha256AflTradeCanonicalJson(f.state.rows[0].typed_payload),
      },
    });
    await expect(
      authenticateAflTradeHpnStatisticalSources(f.transaction, candidate)
    ).rejects.toThrow('measured safe');
  });
  it.each(['measured', 'blank_normalized_zero'] as const)(
    'does not accept unsupported zero provenance labelled %s',
    async (representation) => {
      const f = setup();
      f.state.rows[0].typed_payload.values.Clearances.value = '0';
      const { candidateId: _id, ...body } = f.cell;
      const candidate = createAflTradeHpnStatisticalCell({
        ...body,
        primary: {
          ...body.primary,
          typedPayloadSha256: sha256AflTradeCanonicalJson(f.state.rows[0].typed_payload),
          value: 0,
          representation,
        },
      });
      await expect(
        authenticateAflTradeHpnStatisticalSources(f.transaction, candidate)
      ).rejects.toThrow('governed representation');
    }
  );
  it('requires the retained run to exist when the candidate was created', async () => {
    const f = setup();
    f.state.runs[0].finalized_at = '2026-09-16T02:00:00Z';
    await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
      'exact retained'
    );
  });
});

it('permits the isolated statistical scope only with current exact support and source authority', async () => {
  const f = setup('clearances', true);
  f.state.stagedAuthority = false;
  await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell)).rejects.toThrow(
    'exact clean'
  );
  const support = { decisionId: 'decision', reviewId: 'review' };
  await expect(
    authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell, support)
  ).resolves.toBeDefined();
  f.state.statisticalSource = false;
  await expect(
    authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell, support)
  ).rejects.toThrow('exact clean');
  f.state.statisticalSource = true;
  f.state.statisticalSupport = false;
  await expect(
    authenticateAflTradeHpnStatisticalSources(f.transaction, f.cell, support)
  ).rejects.toThrow('Current exact statistical support');
});
it('retains unknown cache-zero provenance even when explicit supporting evidence permits selection', async () => {
  const f = setup();
  f.state.rows[0].typed_payload.values.Clearances.value = '0';
  const { candidateId: _id, ...body } = f.cell;
  const candidate = createAflTradeHpnStatisticalCell({
    ...body,
    primary: {
      ...body.primary,
      typedPayloadSha256: sha256AflTradeCanonicalJson(f.state.rows[0].typed_payload),
      value: 0,
      representation: 'retained_zero_origin_unknown',
    },
  });
  await expect(authenticateAflTradeHpnStatisticalSources(f.transaction, candidate)).rejects.toThrow(
    'governed representation'
  );
  await expect(
    authenticateAflTradeHpnStatisticalSources(f.transaction, candidate, {
      decisionId: 'decision',
      reviewId: 'review',
    })
  ).resolves.toBeDefined();
});
