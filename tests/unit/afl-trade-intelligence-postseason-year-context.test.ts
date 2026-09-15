import { describe, expect, it } from 'vitest';

import { createAflTradeByteArtifactRef } from '../../src/server/aflTradeIntelligence/artifacts/artifactReference';
import {
  aflTradePostseasonYearContextSchema,
  aflTradePostseasonSeasonWindow,
  createAflTradePostseasonYearContext,
} from '../../src/server/aflTradeIntelligence/domain/postseasonYearContext';

function content() {
  return {
    schemaVersion: 'afl-trade-postseason-year-context/v1' as const,
    environment: 'test_fixture' as const,
    competition: 'AFLM' as const,
    tradeId: 'trade:2014-example',
    promotionId: `external-canonical-promotion:${'a'.repeat(64)}`,
    eventVersionId: 'event:2014-example:v1',
    tradeYear: 2014,
    tradeDate: null,
    period: 'established_postseason' as const,
    reviewDecisionId: 'review:postseason:1',
    reviewEvidence: createAflTradeByteArtifactRef(
      Buffer.from('fixture postseason review'),
      'application/json',
      '2026-09-01T00:00:00.000Z'
    ),
    recordedAt: '2026-09-02T00:00:00.000Z',
    knowledgeCutoffAt: '2026-09-03T00:00:00.000Z',
    knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation' as const,
  };
}

describe('reviewed postseason year context', () => {
  it.each([1, 2, 3] as const)(
    'uses %i completed seasons ending Y and the same three outcome seasons',
    (history) => {
      const context = createAflTradePostseasonYearContext(content());
      const window = aflTradePostseasonSeasonWindow(context, history);
      expect(window.featureSeasons).toEqual([2012, 2013, 2014].slice(3 - history));
      expect(window.outcomeSeasons).toEqual([2015, 2016, 2017]);
      expect(context.content.tradeDate).toBeNull();
      expect(context.content.recordedAt).toBe('2026-09-02T00:00:00.000Z');
      expect(context.content).not.toHaveProperty('tradeEffectiveAt');
    }
  );

  it('requires year-only recording after the complete trade-year bound', () => {
    const input = {
      ...content(),
      reviewEvidence: createAflTradeByteArtifactRef(
        Buffer.from('fixture review'),
        'text/plain',
        '2014-01-01T00:00:00.000Z'
      ),
    };
    for (const recordedAt of ['2014-01-02T00:00:00.000Z', '2014-12-31T23:59:59.999Z']) {
      expect(() => createAflTradePostseasonYearContext({ ...input, recordedAt })).toThrow();
    }
    for (const recordedAt of ['2015-01-01T00:00:00.000Z', '2014-12-31T23:00:00-01:00']) {
      expect(() => createAflTradePostseasonYearContext({ ...input, recordedAt })).not.toThrow();
    }
  });

  it('preserves a known date without deriving it from the year', () => {
    const context = createAflTradePostseasonYearContext({ ...content(), tradeDate: '2014-10-15' });
    expect(context.content.tradeDate).toBe('2014-10-15');
    expect(() =>
      createAflTradePostseasonYearContext({ ...content(), tradeDate: '2015-10-15' })
    ).toThrow();
  });

  it.each(['period', 'reviewDecisionId', 'reviewEvidence', 'promotionId', 'eventVersionId'])(
    'does not establish postseason from a year without %s',
    (field) => {
      const input: Record<string, unknown> = content();
      delete input[field];
      expect(() => createAflTradePostseasonYearContext(input as never)).toThrow();
    }
  );

  it('rejects unsupported scope, inferred periods and extra timestamp fields', () => {
    for (const change of [
      { environment: 'production' },
      { competition: 'AFLW' },
      { period: 'year_only' },
      { tradeEffectiveAt: '2014-12-31T23:59:59.999Z' },
    ]) {
      expect(() =>
        createAflTradePostseasonYearContext({ ...content(), ...change } as never)
      ).toThrow();
    }
  });

  it('separates source recording eligibility from playing-season eligibility', () => {
    expect(() =>
      createAflTradePostseasonYearContext({ ...content(), recordedAt: '2026-08-31T00:00:00.000Z' })
    ).toThrow();
    expect(() =>
      createAflTradePostseasonYearContext({
        ...content(),
        knowledgeCutoffAt: '2026-09-01T00:00:00.000Z',
      })
    ).toThrow();
    expect(() => createAflTradePostseasonYearContext({ ...content(), tradeYear: 2027 })).toThrow();
    expect(() =>
      createAflTradePostseasonYearContext({ ...content(), recordedAt: '2026-09-02T10:00:00+10:00' })
    ).not.toThrow();
  });

  it('detects changes to evidence and trade bindings after sealing', () => {
    const original = createAflTradePostseasonYearContext(content());
    for (const change of [
      { tradeYear: 2015 },
      { tradeId: 'another-trade' },
      { reviewDecisionId: 'another-review' },
    ]) {
      expect(
        aflTradePostseasonYearContextSchema.safeParse({
          ...original,
          content: { ...original.content, ...change },
        }).success
      ).toBe(false);
    }
    expect(createAflTradePostseasonYearContext(content())).toEqual(original);
  });

  it('supports historical calendar planning without claiming historical PAV support', () => {
    const context = createAflTradePostseasonYearContext({ ...content(), tradeYear: 1988 });
    expect(aflTradePostseasonSeasonWindow(context, 3).featureSeasons).toEqual([1986, 1987, 1988]);
    expect(() => aflTradePostseasonSeasonWindow(context, 4 as never)).toThrow();
  });
});
