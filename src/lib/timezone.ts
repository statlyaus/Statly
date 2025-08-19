import { format, formatInTimeZone, zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';
import { addHours, addMinutes, subHours, subMinutes } from 'date-fns';

// Common timezones for AFL (Australian focus)
export const COMMON_TIMEZONES = [
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)', offset: '+10/+11' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)', offset: '+10/+11' },
  { value: 'Australia/Brisbane', label: 'Brisbane (AEST)', offset: '+10' },
  { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)', offset: '+9.5/+10.5' },
  { value: 'Australia/Perth', label: 'Perth (AWST)', offset: '+8' },
  { value: 'Australia/Darwin', label: 'Darwin (ACST)', offset: '+9.5' },
  { value: 'Australia/Hobart', label: 'Hobart (AEST/AEDT)', offset: '+10/+11' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST/NZDT)', offset: '+12/+13' },
  { value: 'UTC', label: 'UTC (Universal)', offset: '+0' },
  { value: 'America/New_York', label: 'New York (EST/EDT)', offset: '-5/-4' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)', offset: '-8/-7' },
  { value: 'Europe/London', label: 'London (GMT/BST)', offset: '+0/+1' },
] as const;

export type SupportedTimeZone = typeof COMMON_TIMEZONES[number]['value'];

/**
 * Convert a local datetime string to UTC for storage
 */
export function localToUtc(localDateTime: string, timeZone: string): Date {
  return zonedTimeToUtc(localDateTime, timeZone);
}

/**
 * Convert UTC datetime to local timezone for display
 */
export function utcToLocal(utcDate: Date, timeZone: string): Date {
  return utcToZonedTime(utcDate, timeZone);
}

/**
 * Format a date in a specific timezone
 */
export function formatInTimezone(
  date: Date,
  timeZone: string,
  formatString: string = 'PPP p'
): string {
  return formatInTimeZone(date, timeZone, formatString);
}

/**
 * Get the current time in a specific timezone
 */
export function nowInTimezone(timeZone: string): Date {
  return utcToZonedTime(new Date(), timeZone);
}

/**
 * Check if a timezone is valid
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get user's browser timezone
 */
export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Convert datetime-local input value to UTC
 */
export function datetimeLocalToUtc(datetimeLocal: string, timeZone: string): Date {
  // datetime-local format: "2025-01-20T19:00"
  return zonedTimeToUtc(datetimeLocal, timeZone);
}

/**
 * Convert UTC date to datetime-local input format
 */
export function utcToDatetimeLocal(utcDate: Date, timeZone: string): string {
  const localDate = utcToZonedTime(utcDate, timeZone);
  return format(localDate, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Calculate reminder times based on draft start time
 */
export function calculateReminderTimes(draftStartUtc: Date): Date[] {
  return [
    subHours(draftStartUtc, 24), // 24 hours before
    subHours(draftStartUtc, 2),  // 2 hours before
    subMinutes(draftStartUtc, 30), // 30 minutes before
    subMinutes(draftStartUtc, 15), // 15 minutes before
  ].filter(time => time > new Date()); // Only future reminders
}

/**
 * Get timezone display info
 */
export function getTimezoneInfo(timeZone: string) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone,
    timeZoneName: 'short',
  });
  
  const parts = formatter.formatToParts(now);
  const timeZoneName = parts.find(part => part.type === 'timeZoneName')?.value || '';
  
  return {
    timeZone,
    name: timeZoneName,
    offset: formatInTimeZone(now, timeZone, 'xxx'),
    currentTime: formatInTimeZone(now, timeZone, 'HH:mm'),
  };
}

/**
 * Find optimal meeting time across multiple timezones
 */
export function findOptimalMeetingTime(
  participantTimezones: string[],
  preferredHours: { start: number; end: number } = { start: 18, end: 22 }
): { time: Date; scores: Array<{ timeZone: string; localTime: string; score: number }> }[] {
  const suggestions: Array<{
    time: Date;
    scores: Array<{ timeZone: string; localTime: string; score: number }>;
  }> = [];

  // Check next 7 days, every hour between 6 AM and 11 PM in the first timezone
  const baseTimeZone = participantTimezones[0] || 'UTC';
  const now = nowInTimezone(baseTimeZone);
  
  for (let day = 0; day < 7; day++) {
    for (let hour = 6; hour <= 23; hour++) {
      const testTime = new Date(now);
      testTime.setDate(testTime.getDate() + day);
      testTime.setHours(hour, 0, 0, 0);
      
      const utcTime = zonedTimeToUtc(testTime, baseTimeZone);
      
      const scores = participantTimezones.map(tz => {
        const localTime = utcToZonedTime(utcTime, tz);
        const localHour = localTime.getHours();
        
        // Score based on how close to preferred hours (18-22 = prime time)
        let score = 0;
        if (localHour >= preferredHours.start && localHour <= preferredHours.end) {
          score = 100; // Perfect time
        } else if (localHour >= 16 && localHour <= 23) {
          score = 75; // Good time
        } else if (localHour >= 14 && localHour <= 16) {
          score = 50; // Okay time
        } else if (localHour >= 9 && localHour <= 14) {
          score = 25; // Poor time
        } else {
          score = 0; // Very poor time
        }
        
        return {
          timeZone: tz,
          localTime: formatInTimeZone(utcTime, tz, 'HH:mm'),
          score,
        };
      });
      
      const averageScore = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
      
      if (averageScore >= 50) { // Only suggest times with decent average score
        suggestions.push({ time: utcTime, scores });
      }
    }
  }
  
  // Sort by average score (best first)
  return suggestions
    .sort((a, b) => {
      const avgA = a.scores.reduce((sum, s) => sum + s.score, 0) / a.scores.length;
      const avgB = b.scores.reduce((sum, s) => sum + s.score, 0) / b.scores.length;
      return avgB - avgA;
    })
    .slice(0, 10); // Return top 10 suggestions
}
