import { describe, expect, it } from 'vitest';
import { createAflTradeByteArtifactRef } from '../../src/server/aflTradeIntelligence/artifacts/artifactReference';
import { createAflTradePostseasonYearContext } from '../../src/server/aflTradeIntelligence/domain/postseasonYearContext';
import { createAflTradeWindowAcquisitionSpellRegistration } from '../../src/server/aflTradeIntelligence/outcomes/acquisitionSpellRegistrationContracts';
import { aflTradePlayerPavObservationSchema } from '../../src/server/aflTradeIntelligence/modeling/playerPavObservationContracts';
import {
  createAflTradePostseasonPlayerPavObservation,
  aflTradePostseasonPlayerPavObservationSchema,
} from '../../src/server/aflTradeIntelligence/modeling/postseasonPlayerPavObservation';
import { aflTradeValuationCaseSchema } from '../../src/server/aflTradeIntelligence/valuation/valuationCaseContracts';
import {
  createAflTradePostseasonValuationCase,
  aflTradePostseasonValuationCaseContentSchema,
} from '../../src/server/aflTradeIntelligence/valuation/postseasonValuationCase';

const id = (prefix: string) => `${prefix}:${'a'.repeat(64)}`;
const evidence = createAflTradeByteArtifactRef(
  Buffer.from('fixture evidence'),
  'text/plain',
  '2026-01-01T00:00:00.000Z'
);
function fixture(observedThrough = '2017-12-31') {
  const context = createAflTradePostseasonYearContext({
    schemaVersion: 'afl-trade-postseason-year-context/v1',
    environment: 'test_fixture',
    competition: 'AFLM',
    tradeId: 'trade:2014',
    promotionId: id('external-canonical-promotion'),
    eventVersionId: 'event:2014',
    tradeYear: 2014,
    tradeDate: null,
    period: 'established_postseason',
    reviewDecisionId: 'review:1',
    reviewEvidence: evidence,
    recordedAt: '2026-01-02T00:00:00.000Z',
    knowledgeCutoffAt: '2026-02-01T00:00:00.000Z',
    knowledgePolicy: 'retrospective_as_recorded_by_dataset_creation',
  });
  const acquisitionSpell = createAflTradeWindowAcquisitionSpellRegistration({
    environment: 'test_fixture',
    competition: 'AFLM',
    playerId: 'player:1',
    clubId: 'club:b',
    entry: {
      promotionId: context.content.promotionId,
      eventVersionId: 'event:2014',
      assetVersionId: 'asset:1',
      eventDate: null,
      datePrecision: {
        precision: 'window',
        eventDate: null,
        earliestDate: '2014-01-01',
        latestDate: '2014-12-31',
      },
      evidence: [evidence],
    },
    departure: null,
    ruleId: id('acquisition-spell-rule'),
    version: 1,
    supersedesSpellVersionId: null,
    observedThrough,
    continuityEvidence: [evidence],
    createdAt: '2026-01-02T00:00:00.000Z',
  });
  const value = (year: number, target = false) => ({
    calculationId: `hpn-pav-season:${year.toString(16).padStart(64, '0')}`,
    calculationSha256: year.toString(16).padStart(64, '0'),
    seasonYear: year,
    effectiveThrough: `${year}-09-30T00:00:00.000Z`,
    calculatedAt: '2026-01-03T00:00:00.000Z',
    spellVersionId: target ? acquisitionSpell.spellVersionId : id('acquisition-spell-version'),
    playerId: 'player:1',
    playerSha256: year.toString(16).padStart(64, 'b'),
    clubId: target ? 'club:b' : 'club:a',
    sourceRowIds: [`row:${year}`],
    gamesPlayed: 1,
    offensivePav: -3,
    midfieldPav: 1,
    defensivePav: 1,
    totalPav: -1,
  });
  const annual = (year: number, target = false) => ({
    seasonYear: year,
    state: 'observed' as const,
    values: [value(year, target)],
    coverageEvidence: evidence,
  });
  const observation = {
    context,
    releaseId: id('outcome-release'),
    acquisitionSpell,
    historySeasons: 1 as const,
    features: [annual(2014)],
    outcomes: [annual(2015, true), annual(2016, true), annual(2017, true)],
  };
  const valuation = {
    context,
    tradeId: 'trade:2014',
    publicAssetBoundary: 'source_native_afl_assets_no_user_or_fantasy_ownership' as const,
    calculationUnit: 'complete_multi_party_trade' as const,
    valuationBundleId: id('valuation-bundle'),
    lineageGraphId: id('lineage-graph'),
    componentDrawSetId: id('component-draw-set'),
    realizedContributionLedgerId: id('realized-contribution-ledger'),
    packagePolicyId: id('package-policy'),
    valueUnitId: 'pav',
    parties: [
      { aflClubId: 'club:b', clubName: 'B', receivedRootAssetIds: ['asset:1'] },
      { aflClubId: 'club:a', clubName: 'A', receivedRootAssetIds: ['asset:2'] },
    ],
    laterAssessment: {
      effectiveAt: '2025-12-31T00:00:00.000Z',
      knowledgeCutoffAt: '2026-02-01T00:00:00.000Z',
      valuationAsOf: '2026-02-02T00:00:00.000Z',
    },
    legacySourceMetricsTreatment:
      'excluded_from_calculation_retained_only_by_separate_legacy_projection' as const,
  };
  return { observation, valuation, annual };
}

describe('postseason builders', () => {
  it.each([1, 2, 3] as const)(
    'connects %i-season history to the common outcome window without a trade timestamp',
    (historySeasons) => {
      const f = fixture();
      const record = createAflTradePostseasonPlayerPavObservation({
        ...f.observation,
        historySeasons,
        features: Array.from({ length: historySeasons }, (_, i) =>
          f.annual(2015 - historySeasons + i)
        ),
      });
      expect(record.content.context.content.tradeDate).toBeNull();
      expect(record.content).not.toHaveProperty('predictionCutoffAt');
      expect(record.content.outcomes.map((s) => s.seasonYear)).toEqual([2015, 2016, 2017]);
      expect(record.content.features[0]).toMatchObject({ values: [{ totalPav: -1 }] });
      expect(aflTradePlayerPavObservationSchema.safeParse(record).success).toBe(false);
    }
  );

  it('rejects future features, shifted horizons, duplicates and foreign player/club values', () => {
    const f = fixture();
    const mutations = [
      { features: [f.annual(2015)] },
      { outcomes: [f.annual(2016, true), f.annual(2017, true), f.annual(2018, true)] },
      {
        features: [
          { ...f.annual(2014), values: [f.annual(2014).values[0], f.annual(2014).values[0]] },
        ],
      },
      {
        features: [
          { ...f.annual(2014), values: [{ ...f.annual(2014).values[0], playerId: 'other' }] },
        ],
      },
      { outcomes: [f.annual(2015), f.annual(2016, true), f.annual(2017, true)] },
      {
        features: [
          {
            ...f.annual(2014),
            values: [{ ...f.annual(2014).values[0], calculatedAt: '2026-03-01T00:00:00.000Z' }],
          },
        ],
      },
    ];
    for (const mutation of mutations)
      expect(() =>
        createAflTradePostseasonPlayerPavObservation({ ...f.observation, ...mutation })
      ).toThrow();
  });

  it('preserves missing history and partial outcomes without filling zeros', () => {
    const f = fixture('2016-10-11');
    expect(() => createAflTradePostseasonPlayerPavObservation(f.observation)).toThrow();
    const record = createAflTradePostseasonPlayerPavObservation({
      ...f.observation,
      features: [{ seasonYear: 2014, state: 'unavailable', reason: 'source_missing' }],
      outcomes: [
        f.annual(2015, true),
        { ...f.annual(2016, true), state: 'partial' },
        { seasonYear: 2017, state: 'unavailable', reason: 'membership_incomplete' },
      ],
    });
    expect(record.content.outcomes[2]).not.toHaveProperty('values');
    expect(record.content.outcomes[1].state).toBe('partial');
    expect(() =>
      createAflTradePostseasonPlayerPavObservation({
        ...f.observation,
        features: [{ ...f.annual(2014), state: 'partial' }],
      })
    ).toThrow();
  });

  it('retains a partial spell value when season calculation coverage ends after membership', () => {
    const f = fixture('2016-06-01');
    const partial = { ...f.annual(2016, true), state: 'partial' as const };
    partial.values[0].effectiveThrough = '2016-12-31T23:59:59.999Z';
    const missing = {
      seasonYear: 2017,
      state: 'unavailable' as const,
      reason: 'membership_incomplete' as const,
    };
    const record = createAflTradePostseasonPlayerPavObservation({
      ...f.observation,
      outcomes: [f.annual(2015, true), partial, missing],
    });
    expect(record.content.outcomes[1]).toMatchObject({
      state: 'partial',
      values: [{ totalPav: -1 }],
    });
    expect(() =>
      createAflTradePostseasonPlayerPavObservation({
        ...f.observation,
        outcomes: [f.annual(2015, true), { ...partial, state: 'observed' }, missing],
      })
    ).toThrow();
    expect(() =>
      createAflTradePostseasonPlayerPavObservation({
        ...f.observation,
        outcomes: [f.annual(2015, true), partial, { ...f.annual(2017, true), state: 'partial' }],
      })
    ).toThrow();
  });

  it('rejects mixed promotion contexts and sealed observation changes', () => {
    const f = fixture();
    const context = createAflTradePostseasonYearContext({
      ...f.observation.context.content,
      eventVersionId: 'other-event',
    });
    expect(() =>
      createAflTradePostseasonPlayerPavObservation({ ...f.observation, context })
    ).toThrow();
    const record = createAflTradePostseasonPlayerPavObservation(f.observation);
    expect(
      aflTradePostseasonPlayerPavObservationSchema.safeParse({
        ...record,
        content: { ...record.content, releaseId: `outcome-release:${'b'.repeat(64)}` },
      }).success
    ).toBe(false);
  });

  it('builds a versioned case with a single later assessment and rejects legacy admission', () => {
    const f = fixture();
    const record = createAflTradePostseasonValuationCase(f.valuation);
    expect(record.content.outcomeSeasons).toEqual([2015, 2016, 2017]);
    expect(record.content.parties.map((p) => p.aflClubId)).toEqual(['club:a', 'club:b']);
    expect(record.content.context.contextId).toBe(f.observation.context.contextId);
    expect(record.content).not.toHaveProperty('tradeEffectiveAt');
    expect(aflTradeValuationCaseSchema.safeParse(record).success).toBe(false);
    expect(
      aflTradePostseasonValuationCaseContentSchema.safeParse({
        ...record.content,
        outcomeSeasons: [2016, 2017, 2018],
      }).success
    ).toBe(false);
  });

  it('rejects mixed trades, duplicate custody and later assessment before the trade bounds', () => {
    const { valuation } = fixture();
    expect(() =>
      createAflTradePostseasonValuationCase({ ...valuation, tradeId: 'other' })
    ).toThrow();
    expect(() =>
      createAflTradePostseasonValuationCase({
        ...valuation,
        parties: [valuation.parties[0], valuation.parties[0]],
      })
    ).toThrow();
    expect(() =>
      createAflTradePostseasonValuationCase({
        ...valuation,
        laterAssessment: { ...valuation.laterAssessment, effectiveAt: '2014-10-01T00:00:00.000Z' },
      })
    ).toThrow();
    expect(() =>
      createAflTradePostseasonValuationCase({
        ...valuation,
        laterAssessment: {
          ...valuation.laterAssessment,
          valuationAsOf: '2025-01-01T00:00:00.000Z',
        },
      })
    ).toThrow();
  });
});
