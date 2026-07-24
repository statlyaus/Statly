const LEAGUE_TIME_ZONE = 'Australia/Melbourne';

const dateTimeFormatter = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: LEAGUE_TIME_ZONE,
  timeZoneName: 'short',
});

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: LEAGUE_TIME_ZONE,
});

export function formatTradeDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'date unavailable' : dateTimeFormatter.format(date);
}

export function formatTradeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not set' : dateFormatter.format(date);
}
