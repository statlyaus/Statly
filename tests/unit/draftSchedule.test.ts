import { describe, expect, it } from 'vitest';

import {
  calendarDateToDraftDate,
  draftScheduleDateForCalendar,
  formatDraftScheduleSummary,
  getDraftScheduleIso,
  resolveDraftSchedule,
  type DraftScheduleValue,
} from '@/lib/draftSchedule';

const melbourneSchedule: DraftScheduleValue = {
  date: '2026-08-01',
  time: '19:00',
  timeZone: 'Australia/Melbourne',
};

describe('draft schedule utilities', () => {
  it('keeps an intentionally empty schedule distinct from invalid input', () => {
    expect(resolveDraftSchedule({ date: '', time: '', timeZone: 'Australia/Melbourne' })).toEqual({
      status: 'empty',
      instant: null,
      error: null,
    });

    expect(
      resolveDraftSchedule({ date: '2026-08-01', time: '', timeZone: 'Australia/Melbourne' })
    ).toMatchObject({ status: 'invalid', error: { code: 'INCOMPLETE' } });
  });

  it('resolves a league wall-clock time to the correct UTC instant', () => {
    const minimum = new Date('2026-07-01T00:00:00.000Z');

    expect(getDraftScheduleIso(melbourneSchedule, minimum)).toBe('2026-08-01T09:00:00.000Z');
    expect(formatDraftScheduleSummary(melbourneSchedule)).toBe(
      'Saturday 1 August 2026 at 7:00 pm AEST'
    );
  });

  it('round-trips the calendar date in the league timezone', () => {
    const calendarDate = draftScheduleDateForCalendar(melbourneSchedule);

    expect(calendarDate).toBeInstanceOf(Date);
    expect(calendarDateToDraftDate(calendarDate!, melbourneSchedule.timeZone)).toBe('2026-08-01');
  });

  it('rejects a local time skipped by daylight saving', () => {
    expect(
      resolveDraftSchedule(
        {
          date: '2026-10-04',
          time: '02:30',
          timeZone: 'Australia/Melbourne',
        },
        new Date('2026-01-01T00:00:00.000Z')
      )
    ).toMatchObject({ status: 'invalid', error: { code: 'NONEXISTENT_TIME' } });
  });

  it('rejects a local time repeated by daylight saving', () => {
    expect(
      resolveDraftSchedule(
        {
          date: '2027-04-04',
          time: '02:30',
          timeZone: 'Australia/Melbourne',
        },
        new Date('2026-01-01T00:00:00.000Z')
      )
    ).toMatchObject({ status: 'invalid', error: { code: 'AMBIGUOUS_TIME' } });
  });

  it('rejects a schedule earlier than the supplied minimum instant', () => {
    expect(
      resolveDraftSchedule(melbourneSchedule, new Date('2026-08-01T10:00:00.000Z'))
    ).toMatchObject({ status: 'invalid', error: { code: 'TOO_SOON' } });
  });
});
