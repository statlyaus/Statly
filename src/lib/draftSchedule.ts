import { addMinutes } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import { isValidTimeZone } from '@/lib/timezone';

export interface DraftScheduleValue {
  date: string;
  time: string;
  timeZone: string;
}

export type DraftScheduleErrorCode =
  | 'INCOMPLETE'
  | 'INVALID_DATE'
  | 'INVALID_TIME'
  | 'INVALID_TIME_ZONE'
  | 'NONEXISTENT_TIME'
  | 'AMBIGUOUS_TIME'
  | 'TOO_SOON';

export type DraftScheduleResolution =
  | { status: 'empty'; instant: null; error: null }
  | {
      status: 'invalid';
      instant: null;
      error: { code: DraftScheduleErrorCode; message: string };
    }
  | { status: 'valid'; instant: Date; error: null };

const DATE_PART_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PART_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const AMBIGUITY_PROBE_MINUTES = [-120, -90, -60, -30, 30, 60, 90, 120];

function invalid(code: DraftScheduleErrorCode, message: string): DraftScheduleResolution {
  return { status: 'invalid', instant: null, error: { code, message } };
}

export function isDraftScheduleEmpty(value: DraftScheduleValue): boolean {
  return !value.date && !value.time;
}

export function resolveDraftSchedule(
  value: DraftScheduleValue,
  minimumInstant: Date = new Date()
): DraftScheduleResolution {
  if (isDraftScheduleEmpty(value)) {
    return { status: 'empty', instant: null, error: null };
  }

  if (!value.date || !value.time) {
    return invalid('INCOMPLETE', 'Choose both a draft date and start time.');
  }

  if (!DATE_PART_PATTERN.test(value.date)) {
    return invalid('INVALID_DATE', 'Choose a valid draft date.');
  }

  if (!TIME_PART_PATTERN.test(value.time)) {
    return invalid('INVALID_TIME', 'Choose a valid draft start time.');
  }

  if (!isValidTimeZone(value.timeZone)) {
    return invalid('INVALID_TIME_ZONE', 'Choose a valid league time zone.');
  }

  const wallTime = `${value.date}T${value.time}`;
  const instant = fromZonedTime(wallTime, value.timeZone);

  if (Number.isNaN(instant.getTime())) {
    return invalid('INVALID_DATE', 'Choose a valid draft date and start time.');
  }

  const resolvedWallTime = formatInTimeZone(instant, value.timeZone, "yyyy-MM-dd'T'HH:mm");
  if (resolvedWallTime !== wallTime) {
    return invalid(
      'NONEXISTENT_TIME',
      'That local time does not exist because the clocks change then. Choose another time.'
    );
  }

  const isAmbiguous = AMBIGUITY_PROBE_MINUTES.some(
    (minutes) =>
      formatInTimeZone(addMinutes(instant, minutes), value.timeZone, "yyyy-MM-dd'T'HH:mm") ===
      wallTime
  );
  if (isAmbiguous) {
    return invalid(
      'AMBIGUOUS_TIME',
      'That local time occurs twice because the clocks change then. Choose another time.'
    );
  }

  if (instant.getTime() < minimumInstant.getTime()) {
    return invalid('TOO_SOON', 'Choose a draft start time in the future.');
  }

  return { status: 'valid', instant, error: null };
}

export function getDraftScheduleIso(
  value: DraftScheduleValue,
  minimumInstant: Date = new Date()
): string | null {
  const resolution = resolveDraftSchedule(value, minimumInstant);
  return resolution.status === 'valid' ? resolution.instant.toISOString() : null;
}

export function formatDraftScheduleSummary(value: DraftScheduleValue): string | null {
  const resolution = resolveDraftSchedule(value, new Date(0));
  if (resolution.status !== 'valid') return null;

  return new Intl.DateTimeFormat('en-AU', {
    timeZone: value.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(resolution.instant);
}

export function draftScheduleFromInstant(instant: Date, timeZone: string): DraftScheduleValue {
  return {
    date: formatInTimeZone(instant, timeZone, 'yyyy-MM-dd'),
    time: formatInTimeZone(instant, timeZone, 'HH:mm'),
    timeZone,
  };
}

export function draftScheduleDateForCalendar(value: DraftScheduleValue): Date | undefined {
  if (!DATE_PART_PATTERN.test(value.date) || !isValidTimeZone(value.timeZone)) {
    return undefined;
  }

  const calendarDate = fromZonedTime(`${value.date}T12:00`, value.timeZone);
  return Number.isNaN(calendarDate.getTime()) ? undefined : calendarDate;
}

export function calendarDateToDraftDate(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, 'yyyy-MM-dd');
}
