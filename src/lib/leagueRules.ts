type UnknownRecord = Record<string, unknown>;

export type WaiverSystem = 'FAAB' | 'ROLLING_LIST' | 'FREE_AGENCY' | 'PRIORITY';
export type WaiverPriorityMode = 'ROLLING' | 'REVERSE_LADDER';

export type LeagueWaiverRules = {
  system: WaiverSystem;
  minimumBid: number;
  waiverPeriodHours: number;
  cantDropList: string[];
  maxWeekAcquisitions?: number;
  maxSeasonAcquisitions?: number;
  priorityMode: WaiverPriorityMode;
  moveWinnerToBack: boolean;
  acquisitionLocked: boolean;
};

function asObject(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

export function parseLeagueWaiverRules(rawSettings: unknown): LeagueWaiverRules {
  const settings = asObject(rawSettings);
  const waiverSettings = asObject(settings.waiverSettings);
  const lockoutSettings = asObject(settings.lockoutSettings);

  const systemRaw = waiverSettings.system;
  const system: WaiverSystem =
    systemRaw === 'FAAB' ||
    systemRaw === 'ROLLING_LIST' ||
    systemRaw === 'FREE_AGENCY' ||
    systemRaw === 'PRIORITY'
      ? systemRaw
      : 'ROLLING_LIST';

  const minimumBid = asNumber(waiverSettings.minimumBid) ?? 1;
  const waiverPeriodHours =
    asNumber(waiverSettings.waiverPeriod) ??
    asNumber(waiverSettings.waiverPeriodHours) ??
    asNumber(settings.waiverPeriodHours) ??
    24;

  const cantDropList = Array.from(
    new Set([
      ...asStringArray(waiverSettings.cantDropList),
      ...asStringArray(settings.cantDropList),
      ...asStringArray(asObject(waiverSettings.dropSettings).cantDropList),
    ])
  );

  const maxWeekAcquisitions =
    asNumber(waiverSettings.maxWeekAcquisitions) ??
    asNumber(settings.maxWeekAcquisitions) ??
    undefined;
  const maxSeasonAcquisitions =
    asNumber(waiverSettings.maxSeasonAcquisitions) ??
    asNumber(settings.maxSeasonAcquisitions) ??
    undefined;

  const priorityModeRaw =
    waiverSettings.priorityMode ??
    waiverSettings.prioritySystem ??
    settings.waiverResetPolicy ??
    settings.priorityMode;
  const priorityMode: WaiverPriorityMode =
    priorityModeRaw === 'REVERSE_LADDER' || priorityModeRaw === 'weekly'
      ? 'REVERSE_LADDER'
      : 'ROLLING';

  const moveWinnerToBack =
    asBoolean(waiverSettings.moveWinnerToBack) ??
    asBoolean(waiverSettings.movesToBack) ??
    asBoolean(settings.moveWinnerToBack) ??
    true;

  const acquisitionLocked =
    asBoolean(waiverSettings.acquisitionLocked) ??
    asBoolean(lockoutSettings.acquisitionLocked) ??
    false;

  return {
    system,
    minimumBid,
    waiverPeriodHours: Math.max(1, Math.round(waiverPeriodHours)),
    cantDropList,
    maxWeekAcquisitions:
      typeof maxWeekAcquisitions === 'number'
        ? Math.max(0, Math.round(maxWeekAcquisitions))
        : undefined,
    maxSeasonAcquisitions:
      typeof maxSeasonAcquisitions === 'number'
        ? Math.max(0, Math.round(maxSeasonAcquisitions))
        : undefined,
    priorityMode,
    moveWinnerToBack,
    acquisitionLocked,
  };
}

export function isCantCutPlayer(playerId: string, rules: LeagueWaiverRules): boolean {
  return rules.cantDropList.includes(playerId);
}

export function getWeekWindowStart(now: Date = new Date()): Date {
  // UTC Monday start-of-week for deterministic backend checks.
  const current = new Date(now);
  const day = current.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  current.setUTCDate(current.getUTCDate() - daysFromMonday);
  current.setUTCHours(0, 0, 0, 0);
  return current;
}
