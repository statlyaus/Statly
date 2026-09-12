import { describe, expect, it } from 'vitest';
import { validateSpecialEntitlementLink } from '@/server/aflTradeIntelligence/source/specialEntitlementLinkValidation';

function fixture() {
  const evidence = [
    {
      captureId: `source-capture:${'1'.repeat(64)}`,
      contentSha256: '2'.repeat(64),
      sourceUrl: 'https://example.test/evidence',
    },
  ];
  const event = { entitlementId: 'synthetic-award-component', evidence };
  return {
    asset: {
      kind: 'special_pick',
      entitlementType: 'expansion_compensation',
      draftYear: null,
      selectionOrdinal: null,
      sourceLabel: 'CMP1 (Synthetic player)',
    },
    award: {
      ...event,
      occurredAt: '2010-10-01T00:00:00Z',
      component: 'CMP1 (Synthetic player)',
      holderClubId: 'a',
    },
    activation: { ...event, occurredAt: '2013-03-01T00:00:00Z', draftYear: 2013 },
    custody: [
      {
        ...event,
        occurredAt: '2010-10-02T00:00:00Z',
        transferId: 't1',
        fromClubId: 'a',
        toClubId: 'b',
      },
    ],
    selection: {
      ...event,
      occurredAt: '2013-11-01T00:00:00Z',
      draftYear: 2013,
      draftType: 'national',
      selectionNumber: 9,
      clubId: 'b',
      playerId: 'p1',
    },
  };
}

describe('special entitlement retrospective link validation', () => {
  it('requires compensation activation but permits mini-draft without a fabricated activation', () => {
    const f = fixture();
    expect(validateSpecialEntitlementLink({ ...f, activation: null }).issues).toContain(
      'missing_applicable_activation'
    );
    expect(
      validateSpecialEntitlementLink({
        ...f,
        activation: null,
        asset: {
          kind: 'special_pick',
          entitlementType: 'mini_draft',
          draftYear: 2011,
          selectionOrdinal: 1,
          sourceLabel: 'M1',
        },
        award: { ...f.award, component: 'M1' },
        selection: {
          ...f.selection,
          draftYear: 2011,
          draftType: 'mini_draft',
          selectionNumber: 1,
          occurredAt: '2011-11-01T00:00:00Z',
        },
      }).status
    ).toBe('internally_consistent');
  });

  it('accepts year-only events without inventing instants', () => {
    const f = fixture();
    const result = validateSpecialEntitlementLink({
      ...f,
      award: { ...f.award, occurredAt: { precision: 'year', year: 2010 } },
      activation: { ...f.activation, occurredAt: { precision: 'year', year: 2013 } },
      custody: f.custody.map((edge) => ({
        ...edge,
        occurredAt: { precision: 'year', year: 2010 },
      })),
      selection: { ...f.selection, occurredAt: { precision: 'year', year: 2013 } },
    });
    expect(result.status).toBe('internally_consistent');
    expect(result.link?.chronologyPrecision).toBe('partial');
    expect(result.link?.evidenceBundle.custody[0].occurredAt).toEqual({
      precision: 'year',
      year: 2010,
    });
  });
  it('accepts a day without requiring a time of day', () => {
    const f = fixture();
    expect(
      validateSpecialEntitlementLink({
        ...f,
        custody: [{ ...f.custody[0], occurredAt: { precision: 'day', date: '2010-10-02' } }],
      }).status
    ).toBe('internally_consistent');
  });
  it('rejects impossible ordering even through an intervening year-only event', () => {
    const f = fixture();
    const result = validateSpecialEntitlementLink({
      ...f,
      award: { ...f.award, occurredAt: '2010-12-01T00:00:00Z' },
      custody: [
        { ...f.custody[0], occurredAt: { precision: 'year', year: 2010 } },
        {
          ...f.custody[0],
          transferId: 'return',
          fromClubId: 'b',
          toClubId: 'a',
          occurredAt: '2010-11-01T00:00:00Z',
        },
      ],
      selection: { ...f.selection, clubId: 'a' },
    });
    expect(result.issues).toContain('custody_chronology_invalid');
  });
  it('retains deferred activation without granting authority or promotion', () => {
    const result = validateSpecialEntitlementLink(fixture());
    expect(result.status).toBe('internally_consistent');
    expect(result.link).toMatchObject({
      scope: 'retrospective_only',
      authorityVerified: false,
      promotionEligible: false,
    });
    expect(result.link?.evidenceBundle.asset.draftYear).toBeNull();
  });
  it.each([
    [
      'award_component_mismatch',
      (x: ReturnType<typeof fixture>) => {
        x.award.component = 'CMP2 (Synthetic player)';
      },
    ],
    [
      'entitlement_identity_mismatch',
      (x: ReturnType<typeof fixture>) => {
        x.selection.entitlementId = 'other';
      },
    ],
    [
      'exercise_year_mismatch',
      (x: ReturnType<typeof fixture>) => {
        x.activation.draftYear = 2014;
      },
    ],
    [
      'selection_kind_or_ordinal_mismatch',
      (x: ReturnType<typeof fixture>) => {
        x.selection.draftType = 'mini_draft';
      },
    ],
    [
      'custody_discontinuity',
      (x: ReturnType<typeof fixture>) => {
        x.custody[0].fromClubId = 'c';
      },
    ],
    [
      'custody_chronology_invalid',
      (x: ReturnType<typeof fixture>) => {
        x.custody[0].occurredAt = '2009-01-01T00:00:00Z';
      },
    ],
    [
      'selection_holder_mismatch',
      (x: ReturnType<typeof fixture>) => {
        x.selection.clubId = 'c';
      },
    ],
    [
      'duplicate_transfer',
      (x: ReturnType<typeof fixture>) => {
        x.custody.push({ ...x.custody[0] });
      },
    ],
    [
      'activation_or_selection_chronology_invalid',
      (x: ReturnType<typeof fixture>) => {
        x.activation.occurredAt = '2014-01-01T00:00:00Z';
      },
    ],
    [
      'capture_binding_conflict',
      (x: ReturnType<typeof fixture>) => {
        x.selection.evidence = [{ ...x.selection.evidence[0], contentSha256: '3'.repeat(64) }];
      },
    ],
    [
      'missing_or_invalid_evidence',
      (x: ReturnType<typeof fixture>) => {
        x.award.evidence = [];
      },
    ],
  ] as const)('blocks %s', (issue, mutate) => {
    const input = fixture();
    mutate(input);
    const result = validateSpecialEntitlementLink(input);
    expect(result.status).toBe('blocked');
    expect(result.issues).toContain(issue);
    expect(result.link).toBeNull();
  });
  it('allows a right to return to a previous holder through distinct dated trades', () => {
    const input = fixture();
    input.custody.push({
      ...input.custody[0],
      transferId: 't2',
      fromClubId: 'b',
      toClubId: 'a',
      occurredAt: '2011-10-01T00:00:00Z',
    });
    input.selection.clubId = 'a';
    expect(validateSpecialEntitlementLink(input).status).toBe('internally_consistent');
  });
});
