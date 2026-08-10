import { describe, expect, it } from 'vitest';

import { createAflTradePrePublicationAvailability } from '@/server/aflTradeIntelligence/publication/prePublicationAvailability';
import {
  AFL_TRADE_METHODOLOGY_HREF,
  aflTradeValueUnavailableSchema,
} from '@/types/aflTradeIntelligence';

function collectObjectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectObjectKeys(entry, keys));
    return keys;
  }
  if (!value || typeof value !== 'object') return keys;

  for (const [key, entry] of Object.entries(value)) {
    keys.add(key);
    collectObjectKeys(entry, keys);
  }
  return keys;
}

describe('AFL trade pre-publication availability', () => {
  it('returns the exact schema-validated no-publication state for the current view', () => {
    const availability = createAflTradePrePublicationAvailability();

    expect(aflTradeValueUnavailableSchema.parse(availability)).toEqual(availability);
    expect(availability).toMatchObject({
      availability: 'not_calculated',
      view: 'current',
      modelVintage: null,
      temporalContext: null,
      reasonCode: 'no-active-publication',
      methodologyHref: AFL_TRADE_METHODOLOGY_HREF,
      nextAction: {
        kind: 'await_calculation',
        href: AFL_TRADE_METHODOLOGY_HREF,
        expectedAfter: null,
      },
      warnings: [],
    });
    expect(availability.message).toContain('no active numerical publication');
  });

  it('contains no numerical, publication, or fantasy ownership payload', () => {
    const availability = createAflTradePrePublicationAvailability();
    const keys = collectObjectKeys(availability);
    const forbiddenKeys = [
      'assessment',
      'clubValues',
      'comparison',
      'coverage',
      'datasetId',
      'estimate',
      'favouredAflClubId',
      'leagueId',
      'lower',
      'membershipId',
      'modelId',
      'ownerId',
      'probabilities',
      'projectionBuildId',
      'publication',
      'publicationId',
      'rosterId',
      'seasonId',
      'unit',
      'upper',
      'userId',
    ];

    expect(forbiddenKeys.filter((key) => keys.has(key))).toEqual([]);
    expect(JSON.stringify(availability)).not.toMatch(/"[^"]+":\s*-?\d/);
  });

  it('does not fabricate a calculation schedule, approval, or outcome claim', () => {
    const availability = createAflTradePrePublicationAvailability();
    const publicCopy = [
      availability.message,
      availability.nextAction?.label,
      availability.nextAction?.expectedAfter,
    ]
      .filter(Boolean)
      .join(' ');

    expect(publicCopy).not.toMatch(
      /approved model|calculating|coming soon|estimated winner|fair trade|release date|scheduled/i
    );
    expect(availability.nextAction?.kind).toBe('await_calculation');
  });

  it('uses source blocked only for an explicit current authority failure', () => {
    expect(createAflTradePrePublicationAvailability('current', 'source_blocked')).toMatchObject({
      availability: 'source_blocked',
      reasonCode: 'valuation-source-authority-not-current',
      nextAction: { kind: 'view_methodology' },
    });
  });
});
