import { describe, expect, it } from 'vitest';

import {
  canonicalPlayerNameKey,
  checkDrafteeRegistration,
  draftguruDrafteePlayerId,
  earlierSameNamePlanPlayerIds,
  parseDrafteeRegistrationPlan,
  type DrafteeSubjectItem,
} from '@/server/aflTradeIntelligence/development/drafteeRegistrationPlan';

function item(
  provider: string,
  nativeId: string,
  observedNames: string[] = ['Max King'],
  seasons: [number, number] = [2026, 2026]
): DrafteeSubjectItem {
  return {
    subjectId: `external-identity-subject:${provider}-${nativeId}`,
    workItem: {
      content: {
        subject: {
          content: {
            provider,
            entityKind: 'player',
            identityScope: { kind: 'provider_native_id', nativeId },
          },
        },
        observedNames,
        validFromSeason: seasons[0],
        validThroughSeason: seasons[1],
      },
    },
  };
}

const entry = {
  draftguruNativeId: 'max_king/3',
  displayName: 'Max King',
  draftingClub: 'Sydney',
  season: 2026,
  pick: 49,
};

describe('draftee registration plan', () => {
  it('keeps the 2025 player id rule (Max King, max_king/3)', () => {
    expect(draftguruDrafteePlayerId('max_king/3')).toBe(
      'player:bad64508f9b98060eda2aee3ae2d32eefd2b22f4f8dc0fa10960b4412f837a99'
    );
  });

  it('reads one draftee per line and refuses repeats, unknown fields and unsorted lists', () => {
    const line = JSON.stringify({ ...entry, footyinfoNativeId: 'max-king-2' });
    expect(parseDrafteeRegistrationPlan(`${line}\n\n`)).toEqual([
      { ...entry, footyinfoNativeId: 'max-king-2' },
    ]);
    expect(() => parseDrafteeRegistrationPlan(`${line}\n${line}`)).toThrow('repeats');
    expect(() => parseDrafteeRegistrationPlan('')).toThrow('no draftees');
    expect(() => parseDrafteeRegistrationPlan('{')).toThrow('line 1 is not JSON');
    expect(() =>
      parseDrafteeRegistrationPlan(JSON.stringify({ ...entry, birthDate: null }))
    ).toThrow('line 1 is invalid');
    expect(() =>
      parseDrafteeRegistrationPlan(
        JSON.stringify({ ...entry, distinctFromPlayerIds: ['player:b', 'player:a'] })
      )
    ).toThrow('ascending');
  });

  it('creates from the Draftguru subject and links the Footyinfo subject when both are observed', () => {
    const draftguru = item('draftguru', 'max_king/3');
    const footyinfo = item('footyinfo', 'max-king-2', ['MAX  KING.']);
    expect(
      checkDrafteeRegistration(
        { ...entry, footyinfoNativeId: 'max-king-2' },
        [draftguru, footyinfo],
        []
      )
    ).toEqual({ status: 'create', draftguru, footyinfo });
  });

  it('links a Footyinfo spelling with another name key only when the plan names it', () => {
    const nairn = { ...entry, draftguruNativeId: 'cam_nairn', displayName: 'Cameron Nairn' };
    const items = [
      item('draftguru', 'cam_nairn', ['Cameron Nairn']),
      item('footyinfo', 'cam-nairn', ['Cam Nairn']),
      item('footyinfo', 'cam-smith', ['Cam Smith']),
    ];
    expect(
      checkDrafteeRegistration({ ...nairn, footyinfoNativeId: 'cam-nairn' }, items, [])
    ).toMatchObject({ status: 'refused', reasons: ['footyinfo_name_not_observed'] });
    expect(
      checkDrafteeRegistration(
        { ...nairn, footyinfoNativeId: 'cam-nairn', footyinfoRecordedName: 'Cam Nairn' },
        items,
        []
      )
    ).toMatchObject({ status: 'create' });
    // A wrong slug points at another person: refused even with a recorded name.
    expect(
      checkDrafteeRegistration(
        { ...nairn, footyinfoNativeId: 'cam-smith', footyinfoRecordedName: 'Cam Nairn' },
        items,
        []
      )
    ).toMatchObject({ status: 'refused', reasons: ['footyinfo_name_not_observed'] });
  });

  it('treats an earlier plan line with the same name key as a same-name player', () => {
    const plan = [
      entry,
      { ...entry, draftguruNativeId: 'other', displayName: 'Ben Smith' },
      { ...entry, draftguruNativeId: 'max_king/4', displayName: 'MAX KING' },
    ];
    expect(canonicalPlayerNameKey(' Max  KING. ')).toBe('maxking');
    expect(earlierSameNamePlanPlayerIds(plan, 0)).toEqual([]);
    expect(earlierSameNamePlanPlayerIds(plan, 2)).toEqual([draftguruDrafteePlayerId('max_king/3')]);
  });

  it('refuses a draftee the completion does not observe as planned', () => {
    expect(checkDrafteeRegistration(entry, [item('footyinfo', 'max_king/3')], [])).toEqual({
      status: 'refused',
      reasons: ['no_draftguru_subject'],
      listedNotSameName: [],
    });
    expect(
      checkDrafteeRegistration(
        { ...entry, footyinfoNativeId: 'max-king-2' },
        [item('draftguru', 'max_king/3', ['Maxwell King'], [2025, 2025])],
        []
      )
    ).toMatchObject({
      status: 'refused',
      reasons: [
        'draftguru_name_not_observed',
        'draftguru_season_not_observed',
        'no_footyinfo_subject',
      ],
    });
  });

  it('holds a same-name draftee until every same-name player is listed as distinct', () => {
    const items = [item('draftguru', 'max_king/3')];
    expect(checkDrafteeRegistration(entry, items, ['player:z', 'player:a'])).toEqual({
      status: 'hold',
      unreviewedSameNamePlayerIds: ['player:a', 'player:z'],
    });
    expect(
      checkDrafteeRegistration({ ...entry, distinctFromPlayerIds: ['player:a'] }, items, [
        'player:a',
        'player:z',
      ])
    ).toEqual({ status: 'hold', unreviewedSameNamePlayerIds: ['player:z'] });
    expect(
      checkDrafteeRegistration(
        { ...entry, distinctFromPlayerIds: ['player:a', 'player:z'] },
        items,
        ['player:a', 'player:z']
      )
    ).toMatchObject({ status: 'create' });
    expect(
      checkDrafteeRegistration({ ...entry, distinctFromPlayerIds: ['player:other'] }, items, [])
    ).toEqual({
      status: 'refused',
      reasons: ['distinct_from_not_same_name'],
      listedNotSameName: ['player:other'],
    });
  });
});
