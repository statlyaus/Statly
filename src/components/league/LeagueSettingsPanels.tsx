'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  CategoryDirection,
  League,
  LeagueFixtureGenerationMode,
  LeagueLineupSlotSettings,
  LeagueMember,
  LeagueMemberNotificationSettings,
  LeagueScoringMode,
} from '@/types/leagues';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';
import {
  DEFAULT_DRAFT_AUTO_PICK_RULES,
  DEFAULT_DRAFT_POSITION_LIMITS,
  POSITION_LIMIT_KEYS,
  TIME_PER_PICK_OPTIONS,
  type DraftAutoPickRules,
  type DraftPickOrderMode,
  type DraftPositionLimits,
  type PositionLimitKey,
} from '@/lib/draftSettings';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { parseLeagueFormat } from '@/lib/leagueFormatOptions';
import { MAX_LEAGUE_TEAMS, MIN_LEAGUE_TEAMS } from '@/server/leagues/leagueCapacity';
import {
  DEFAULT_TEAM_SYMBOL_ZOOM,
  MAX_TEAM_SYMBOL_ZOOM,
  MIN_TEAM_SYMBOL_ZOOM,
} from '@/lib/teamSymbol';
import {
  getTeamInitials,
  getTeamLogoImageStyle,
  getTeamLogoPositionValue,
  getTeamLogoZoomValue,
  isRecord,
  LEAGUE_CATEGORY_PRESET,
  normalizeFantasyCategoryList,
} from './leagueTabPanelUtils';
import { CompetitionSettingsPanel } from './settings/CompetitionSettingsPanel';
import {
  ScoringSettingsPanel,
  type LeagueFormatSettingsValue,
} from './settings/ScoringSettingsPanel';
import { SeasonYearControl } from './settings/SeasonYearControl';

type TeamNotificationToggleKey = 'tradePush' | 'waiverPush' | 'draftReminder' | 'scoringAlerts';

type LeagueSettingsDraftType = 'snake' | 'linear';
type LeagueSettingsWaiverRule = 'weekly' | 'rolling';

interface LeagueSettingsResponse {
  league: {
    id: string;
    name: string;
    code: string;
    maxTeams: number;
    locked: boolean;
  };
  scoring: {
    scoringFormat: 'nine-category';
    categories: FantasyCategoryKey[];
    scoringMode: LeagueScoringMode;
    fixtureGenerationMode: LeagueFixtureGenerationMode;
    lineupSlots: LeagueLineupSlotSettings;
    categoryDirections: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
    scoringSettingsLockedAt: string | null;
  };
  // League format (Bloodsucker, epic #1275); locks with the draft structure.
  format: LeagueFormatSettingsValue;
  // Why scoring or draft structure can no longer change; null while it is still editable.
  locks: {
    scoring: string | null;
    draftStructure: string | null;
  };
  roster: {
    rosterSize: number;
    benchSize: number;
    positionLimits: DraftPositionLimits;
  };
  draft: {
    draftDate: string;
    draftType: LeagueSettingsDraftType;
    timePerPick: number;
    pickOrder: DraftPickOrderMode;
    timeZone: string;
    autoPickRules: DraftAutoPickRules;
  };
  waiver: {
    waiverRule: LeagueSettingsWaiverRule;
    // FAAB budget per member; null means the league uses waiver priority order.
    faabBudget: number | null;
  };
}

type LeagueSettingsMessage = {
  type: 'success' | 'error';
  text: string;
};

const POSITION_LIMIT_LABELS: Record<PositionLimitKey, string> = {
  DEF: 'Defenders',
  MID: 'Midfielders',
  RUC: 'Rucks',
  FWD: 'Forwards',
  BENCH: 'Bench',
};

const DEFAULT_LINEUP_SLOTS: LeagueLineupSlotSettings = {
  FWD: 5,
  DEF: 5,
  MID: 5,
  RUC: 1,
  UTIL: 3,
};
const TEAM_SYMBOL_UPLOAD_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEAM_SYMBOL_UPLOAD_MAX_BYTES = 2_000_000;
const TEAM_SYMBOL_CANVAS_SIZE = 256;
const DEFAULT_MEMBER_NOTIFICATION_SETTINGS: LeagueMemberNotificationSettings = {
  tradePush: true,
  waiverPush: true,
  draftReminder: true,
  scoringAlerts: true,
};

function normalizeLineupSlotSettings(value: unknown): LeagueLineupSlotSettings {
  const source = isRecord(value) ? value : {};
  return {
    FWD: asNumber(source.FWD, DEFAULT_LINEUP_SLOTS.FWD),
    DEF: asNumber(source.DEF, DEFAULT_LINEUP_SLOTS.DEF),
    MID: asNumber(source.MID, DEFAULT_LINEUP_SLOTS.MID),
    RUC: asNumber(source.RUC, DEFAULT_LINEUP_SLOTS.RUC),
    UTIL: asNumber(source.UTIL, DEFAULT_LINEUP_SLOTS.UTIL),
  };
}

function normalizeCategoryDirectionSettings(
  categories: readonly FantasyCategoryKey[],
  value: unknown
): Partial<Record<FantasyCategoryKey, CategoryDirection>> {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    categories.map((category) => [
      category,
      source[category] === 'LOW_WINS' ? 'LOW_WINS' : 'HIGH_WINS',
    ])
  ) as Partial<Record<FantasyCategoryKey, CategoryDirection>>;
}

function createFallbackLeagueSettings(league: League): LeagueSettingsResponse {
  const draftDate =
    league.draftDate ?? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  return {
    league: {
      id: league.id,
      name: league.name,
      code: league.code,
      maxTeams: league.maxTeams,
      locked: false,
    },
    scoring: {
      scoringFormat: 'nine-category',
      categories: league.categories?.length ? league.categories : [...LEAGUE_CATEGORY_PRESET],
      scoringMode: league.scoringMode ?? 'H2H_EACH_CATEGORY',
      fixtureGenerationMode: league.fixtureGenerationMode ?? 'AUTOMATIC',
      lineupSlots: league.lineupSlots ?? DEFAULT_LINEUP_SLOTS,
      categoryDirections: normalizeCategoryDirectionSettings(
        league.categories?.length ? league.categories : LEAGUE_CATEGORY_PRESET,
        league.categoryDirections
      ),
      scoringSettingsLockedAt: league.scoringSettingsLockedAt ?? null,
    },
    locks: { scoring: null, draftStructure: null },
    format: {
      leagueFormat: league.leagueFormat ?? 'STANDARD',
      bloodsuckerMemberId: null,
      candidates: [],
    },
    roster: {
      rosterSize: 18,
      benchSize: DEFAULT_DRAFT_POSITION_LIMITS.BENCH,
      positionLimits: { ...DEFAULT_DRAFT_POSITION_LIMITS },
    },
    draft: {
      draftDate,
      draftType: league.draftType ?? 'snake',
      timePerPick: 120,
      pickOrder: league.pickOrder ?? 'random',
      timeZone: 'Australia/Melbourne',
      autoPickRules: { ...DEFAULT_DRAFT_AUTO_PICK_RULES },
    },
    waiver: {
      waiverRule: league.waiverRule ?? 'weekly',
      faabBudget: null,
    },
  };
}

function normalizeLeagueFormatSettings(
  value: unknown,
  fallback: LeagueFormatSettingsValue
): LeagueFormatSettingsValue {
  const source = isRecord(value) ? value : {};
  return {
    leagueFormat: parseLeagueFormat(source.leagueFormat, fallback.leagueFormat),
    bloodsuckerMemberId:
      typeof source.bloodsuckerMemberId === 'string' ? source.bloodsuckerMemberId : null,
    candidates: Array.isArray(source.candidates)
      ? source.candidates.filter(
          (candidate): candidate is LeagueFormatSettingsValue['candidates'][number] =>
            isRecord(candidate) &&
            typeof candidate.memberId === 'string' &&
            typeof candidate.teamName === 'string'
        )
      : [],
  };
}

function normalizeLeagueSettingsPayload(value: unknown, league: League): LeagueSettingsResponse {
  const fallback = createFallbackLeagueSettings(league);
  const source = isRecord(value) ? value : {};
  const leagueSource = isRecord(source.league) ? source.league : {};
  const rosterSource = isRecord(source.roster) ? source.roster : {};
  const scoringSource = isRecord(source.scoring) ? source.scoring : {};
  const draftSource = isRecord(source.draft) ? source.draft : {};
  const waiverSource = isRecord(source.waiver) ? source.waiver : {};
  const locksSource = isRecord(source.locks) ? source.locks : {};

  return {
    league: {
      id: league.id,
      name: asString(leagueSource.name, fallback.league.name),
      code: asString(leagueSource.code, fallback.league.code),
      maxTeams: asNumber(leagueSource.maxTeams, fallback.league.maxTeams),
      locked: Boolean(leagueSource.locked ?? fallback.league.locked),
    },
    scoring: {
      scoringFormat: 'nine-category',
      categories: normalizeFantasyCategoryList(
        scoringSource.categories,
        fallback.scoring.categories
      ),
      scoringMode:
        scoringSource.scoringMode === 'H2H_MOST_CATEGORIES'
          ? 'H2H_MOST_CATEGORIES'
          : fallback.scoring.scoringMode,
      fixtureGenerationMode:
        scoringSource.fixtureGenerationMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC',
      lineupSlots: normalizeLineupSlotSettings(scoringSource.lineupSlots),
      categoryDirections: normalizeCategoryDirectionSettings(
        normalizeFantasyCategoryList(scoringSource.categories, fallback.scoring.categories),
        scoringSource.categoryDirections
      ),
      scoringSettingsLockedAt:
        typeof scoringSource.scoringSettingsLockedAt === 'string'
          ? scoringSource.scoringSettingsLockedAt
          : null,
    },
    format: normalizeLeagueFormatSettings(source.format, fallback.format),
    locks: {
      scoring: typeof locksSource.scoring === 'string' ? locksSource.scoring : null,
      draftStructure:
        typeof locksSource.draftStructure === 'string' ? locksSource.draftStructure : null,
    },
    roster: {
      rosterSize: asNumber(rosterSource.rosterSize, fallback.roster.rosterSize),
      benchSize: asNumber(rosterSource.benchSize, fallback.roster.benchSize),
      positionLimits: normalizePositionLimits(rosterSource.positionLimits),
    },
    draft: {
      draftDate: asString(draftSource.draftDate, fallback.draft.draftDate),
      draftType: asDraftType(draftSource.draftType, fallback.draft.draftType),
      timePerPick: asNumber(draftSource.timePerPick, fallback.draft.timePerPick),
      pickOrder: asPickOrder(draftSource.pickOrder, fallback.draft.pickOrder),
      timeZone: asString(draftSource.timeZone, fallback.draft.timeZone),
      autoPickRules: normalizeAutoPickRules(draftSource.autoPickRules),
    },
    waiver: {
      waiverRule: asWaiverRule(waiverSource.waiverRule, fallback.waiver.waiverRule),
      faabBudget: typeof waiverSource.faabBudget === 'number' ? waiverSource.faabBudget : null,
    },
  };
}

function getMemberNotificationSettings(member?: LeagueMember): LeagueMemberNotificationSettings {
  return {
    ...DEFAULT_MEMBER_NOTIFICATION_SETTINGS,
    ...member?.notificationSettings,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Could not read image file.'));
    };
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

function resizeTeamSymbolDataUrl(
  dataUrl: string,
  positionX = 50,
  positionY = 50,
  zoom = DEFAULT_TEAM_SYMBOL_ZOOM
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TEAM_SYMBOL_CANVAS_SIZE;
      canvas.height = TEAM_SYMBOL_CANVAS_SIZE;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Could not prepare image.'));
        return;
      }

      const size = Math.min(image.naturalWidth, image.naturalHeight) / getTeamLogoZoomValue(zoom);
      const maxSourceX = Math.max(0, image.naturalWidth - size);
      const maxSourceY = Math.max(0, image.naturalHeight - size);
      const sourceX = Math.round(maxSourceX * (getTeamLogoPositionValue(positionX) / 100));
      const sourceY = Math.round(maxSourceY * (getTeamLogoPositionValue(positionY) / 100));
      context.drawImage(
        image,
        sourceX,
        sourceY,
        size,
        size,
        0,
        0,
        TEAM_SYMBOL_CANVAS_SIZE,
        TEAM_SYMBOL_CANVAS_SIZE
      );
      resolve(canvas.toDataURL('image/webp', 0.82));
    };
    image.onerror = () => reject(new Error('Could not load image file.'));
    image.src = dataUrl;
  });
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asDraftType(value: unknown, fallback: LeagueSettingsDraftType): LeagueSettingsDraftType {
  return String(value ?? fallback).toLowerCase() === 'linear' ? 'linear' : 'snake';
}

function asPickOrder(value: unknown, fallback: DraftPickOrderMode): DraftPickOrderMode {
  return String(value ?? fallback).toLowerCase() === 'manual' ? 'manual' : 'random';
}

function asWaiverRule(
  value: unknown,
  fallback: LeagueSettingsWaiverRule
): LeagueSettingsWaiverRule {
  return String(value ?? fallback).toLowerCase() === 'rolling' ? 'rolling' : 'weekly';
}

function normalizePositionLimits(value: unknown): DraftPositionLimits {
  const source = isRecord(value) ? value : {};
  return POSITION_LIMIT_KEYS.reduce<DraftPositionLimits>((limits, key) => {
    const parsed = asNumber(source[key], DEFAULT_DRAFT_POSITION_LIMITS[key]);
    limits[key] = Math.max(0, Math.min(parsed, key === 'BENCH' ? 20 : 30));
    return limits;
  }, {} as DraftPositionLimits);
}

function normalizeAutoPickRules(value: unknown): DraftAutoPickRules {
  const source = isRecord(value) ? value : {};
  const strategy = String(source.strategy ?? DEFAULT_DRAFT_AUTO_PICK_RULES.strategy).toLowerCase();

  return {
    enabled: source.enabled !== false,
    strategy:
      strategy === 'best-available' || strategy === 'fill-positions'
        ? strategy
        : DEFAULT_DRAFT_AUTO_PICK_RULES.strategy,
  };
}

function toDateTimeLocalValue(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

export function TeamSettingsPanel({
  league,
  currentUserId,
  currentMember,
  onMemberChange,
}: {
  league: League;
  currentUserId?: string;
  currentMember?: LeagueMember;
  onMemberChange?: (member: LeagueMember) => void;
}) {
  const [teamName, setTeamName] = useState(currentMember?.teamName ?? '');
  const [notificationSettings, setNotificationSettings] =
    useState<LeagueMemberNotificationSettings>(() => getMemberNotificationSettings(currentMember));
  const [teamSettingsMessage, setTeamSettingsMessage] = useState<LeagueSettingsMessage | null>(
    null
  );
  const [isSavingTeamSettings, setIsSavingTeamSettings] = useState(false);
  const [teamSymbolUrl, setTeamSymbolUrl] = useState(currentMember?.teamLogoUrl ?? '');
  const [teamSymbolPositionX, setTeamSymbolPositionX] = useState(
    getTeamLogoPositionValue(currentMember?.teamLogoPositionX)
  );
  const [teamSymbolPositionY, setTeamSymbolPositionY] = useState(
    getTeamLogoPositionValue(currentMember?.teamLogoPositionY)
  );
  const [teamSymbolZoom, setTeamSymbolZoom] = useState(
    getTeamLogoZoomValue(currentMember?.teamLogoZoom)
  );
  const [pendingTeamSymbolUploadDataUrl, setPendingTeamSymbolUploadDataUrl] = useState<
    string | null
  >(null);
  const [teamSymbolMessage, setTeamSymbolMessage] = useState<LeagueSettingsMessage | null>(null);
  const [isSavingTeamSymbol, setIsSavingTeamSymbol] = useState(false);

  useEffect(() => {
    setTeamName(currentMember?.teamName ?? '');
    setNotificationSettings(getMemberNotificationSettings(currentMember));
    setTeamSymbolUrl(currentMember?.teamLogoUrl ?? '');
    setTeamSymbolPositionX(getTeamLogoPositionValue(currentMember?.teamLogoPositionX));
    setTeamSymbolPositionY(getTeamLogoPositionValue(currentMember?.teamLogoPositionY));
    setTeamSymbolZoom(getTeamLogoZoomValue(currentMember?.teamLogoZoom));
    setPendingTeamSymbolUploadDataUrl(null);
  }, [
    currentMember?.notificationSettings,
    currentMember?.teamLogoPositionX,
    currentMember?.teamLogoPositionY,
    currentMember?.teamLogoUrl,
    currentMember?.teamLogoZoom,
    currentMember?.teamName,
  ]);

  const updateNotificationSetting = (key: TeamNotificationToggleKey, value: boolean) => {
    setNotificationSettings((current) => ({ ...current, [key]: value }));
  };

  const mergeMemberResponse = (payload: unknown, fallback: LeagueMember): LeagueMember => {
    return isRecord(payload) && isRecord(payload.data) && isRecord(payload.data.member)
      ? ({ ...fallback, ...payload.data.member } as LeagueMember)
      : fallback;
  };

  const saveTeamSettings = async () => {
    if (!currentUserId || !currentMember) return;

    try {
      setIsSavingTeamSettings(true);
      setTeamSettingsMessage(null);
      const response = await authenticatedFetch(
        `/api/leagues/${league.id}/members/me`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamName,
            notificationSettings,
          }),
        },
        currentUserId
      );
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `status ${response.status}`);
      }

      const nextMember = mergeMemberResponse(payload, {
        ...currentMember,
        teamName: teamName.trim(),
        notificationSettings,
      });
      setTeamName(nextMember.teamName);
      setNotificationSettings(getMemberNotificationSettings(nextMember));
      onMemberChange?.(nextMember);
      setTeamSettingsMessage({ type: 'success', text: 'Team settings saved.' });
    } catch (error) {
      setTeamSettingsMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save team settings.',
      });
    } finally {
      setIsSavingTeamSettings(false);
    }
  };

  const saveTeamSymbol = async (
    nextTeamSymbolUrl: string,
    nextPositionX = teamSymbolPositionX,
    nextPositionY = teamSymbolPositionY,
    nextZoom = teamSymbolZoom
  ) => {
    if (!currentUserId || !currentMember) return;

    const normalizedPositionX = getTeamLogoPositionValue(nextPositionX);
    const normalizedPositionY = getTeamLogoPositionValue(nextPositionY);
    const normalizedZoom = getTeamLogoZoomValue(nextZoom);

    try {
      setIsSavingTeamSymbol(true);
      setTeamSymbolMessage(null);
      const shouldResizePendingUpload =
        pendingTeamSymbolUploadDataUrl && nextTeamSymbolUrl === pendingTeamSymbolUploadDataUrl;
      const teamLogoUrlForSave = shouldResizePendingUpload
        ? await resizeTeamSymbolDataUrl(
            pendingTeamSymbolUploadDataUrl,
            normalizedPositionX,
            normalizedPositionY,
            normalizedZoom
          )
        : nextTeamSymbolUrl;
      const response = await authenticatedFetch(
        `/api/leagues/${league.id}/members/me`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teamLogoUrl: teamLogoUrlForSave,
            teamLogoPositionX: normalizedPositionX,
            teamLogoPositionY: normalizedPositionY,
            teamLogoZoom: normalizedZoom,
          }),
        },
        currentUserId
      );
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `status ${response.status}`);
      }

      const nextMember = mergeMemberResponse(payload, {
        ...currentMember,
        teamLogoUrl: teamLogoUrlForSave || undefined,
        teamLogoPositionX: normalizedPositionX,
        teamLogoPositionY: normalizedPositionY,
        teamLogoZoom: normalizedZoom,
      });

      setTeamSymbolUrl(nextMember.teamLogoUrl ?? '');
      setTeamSymbolPositionX(getTeamLogoPositionValue(nextMember.teamLogoPositionX));
      setTeamSymbolPositionY(getTeamLogoPositionValue(nextMember.teamLogoPositionY));
      setTeamSymbolZoom(getTeamLogoZoomValue(nextMember.teamLogoZoom));
      setPendingTeamSymbolUploadDataUrl(null);
      onMemberChange?.(nextMember);
      setTeamSymbolMessage({ type: 'success', text: 'Team symbol saved.' });
    } catch (error) {
      setTeamSymbolMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save team symbol.',
      });
    } finally {
      setIsSavingTeamSymbol(false);
    }
  };

  const handleTeamSymbolUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!TEAM_SYMBOL_UPLOAD_TYPES.has(file.type)) {
      setTeamSymbolMessage({ type: 'error', text: 'Upload a PNG, JPEG, or WebP image.' });
      return;
    }
    if (file.size > TEAM_SYMBOL_UPLOAD_MAX_BYTES) {
      setTeamSymbolMessage({ type: 'error', text: 'Upload an image smaller than 2 MB.' });
      return;
    }

    try {
      setTeamSymbolMessage(null);
      const dataUrl = await readFileAsDataUrl(file);
      setPendingTeamSymbolUploadDataUrl(dataUrl);
      setTeamSymbolUrl(dataUrl);
    } catch (error) {
      setTeamSymbolMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to upload team symbol.',
      });
    }
  };

  if (!currentMember) {
    return (
      <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        Join this league to manage team settings.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Team Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your team name, identity, and league notifications.
        </p>
      </div>

      {teamSettingsMessage && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            teamSettingsMessage.type === 'success'
              ? 'border-border bg-muted text-foreground'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {teamSettingsMessage.text}
        </div>
      )}

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] lg:items-start">
          <div>
            <h3 className="text-base font-semibold text-foreground">Team details</h3>
            <div className="mt-4 grid gap-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
                Team name
                <input
                  type="text"
                  value={teamName}
                  onChange={(event) => setTeamName(event.target.value)}
                  className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['tradePush', 'Trade offers'],
                    ['waiverPush', 'Waiver updates'],
                    ['draftReminder', 'Draft reminders'],
                    ['scoringAlerts', 'Scoring alerts'],
                  ] satisfies Array<[TeamNotificationToggleKey, string]>
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex min-h-10 items-center gap-3 rounded-md border border-border bg-muted px-3 text-sm font-medium text-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={notificationSettings[key]}
                      onChange={(event) => updateNotificationSetting(key, event.target.checked)}
                      className="size-4 rounded border-border text-brand-bar focus:ring-brand-bar"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => void saveTeamSettings()}
                  disabled={isSavingTeamSettings}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground transition hover:bg-brand-bar-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar disabled:opacity-60"
                >
                  {isSavingTeamSettings ? 'Saving...' : 'Save team settings'}
                </button>
              </div>
            </div>
          </div>

          <div className="relative flex aspect-square w-full max-w-sm items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted shadow-sm">
            {teamSymbolUrl ? (
              <img
                src={teamSymbolUrl}
                alt={`${currentMember.teamName} symbol preview`}
                referrerPolicy="no-referrer"
                style={getTeamLogoImageStyle({
                  teamLogoPositionX: teamSymbolPositionX,
                  teamLogoPositionY: teamSymbolPositionY,
                  teamLogoZoom: teamSymbolZoom,
                })}
                className="h-full w-full object-cover will-change-transform"
              />
            ) : (
              <span className="text-5xl font-semibold text-foreground">
                {getTeamInitials(currentMember.teamName)}
              </span>
            )}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,transparent_calc(50%-0.5px),rgba(255,255,255,0.72)_calc(50%-0.5px),rgba(255,255,255,0.72)_calc(50%+0.5px),transparent_calc(50%+0.5px)),linear-gradient(to_bottom,transparent_calc(50%-0.5px),rgba(255,255,255,0.72)_calc(50%-0.5px),rgba(255,255,255,0.72)_calc(50%+0.5px),transparent_calc(50%+0.5px))] mix-blend-difference"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-4 rounded-xl border border-white/45 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]"
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:items-start">
          <div>
            <h3 className="text-base font-semibold text-foreground">Team identity</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Position the image used for your team across {league.name}.
            </p>
          </div>

          <div className="flex flex-col gap-5">
            {teamSymbolMessage && (
              <div
                role="status"
                className={`rounded-lg border px-4 py-3 text-sm ${
                  teamSymbolMessage.type === 'success'
                    ? 'border-border bg-muted text-foreground'
                    : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {teamSymbolMessage.text}
              </div>
            )}

            <div className="grid gap-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
                Team symbol URL
                <input
                  type="url"
                  value={teamSymbolUrl.startsWith('data:') ? '' : teamSymbolUrl}
                  placeholder="https://example.com/team-symbol.png"
                  onChange={(event) => {
                    setPendingTeamSymbolUploadDataUrl(null);
                    setTeamSymbolUrl(event.target.value);
                  }}
                  className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
                  Upload team symbol
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => void handleTeamSymbolUpload(event.target.files?.[0])}
                    className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-4 file:py-2 file:text-sm file:font-semibold file:text-foreground"
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveTeamSymbol(teamSymbolUrl)}
                    disabled={isSavingTeamSymbol}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground transition hover:bg-brand-bar-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar disabled:opacity-60"
                  >
                    {isSavingTeamSymbol ? 'Saving...' : 'Save team symbol'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveTeamSymbol('')}
                    disabled={isSavingTeamSymbol}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-muted px-4 text-sm font-semibold text-foreground transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar disabled:opacity-60"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
                Zoom
                <div className="flex items-center gap-3">
                  <span className="w-10 text-xs text-muted-foreground">1x</span>
                  <input
                    type="range"
                    min={MIN_TEAM_SYMBOL_ZOOM}
                    max={MAX_TEAM_SYMBOL_ZOOM}
                    step="0.05"
                    value={teamSymbolZoom}
                    onChange={(event) =>
                      setTeamSymbolZoom(getTeamLogoZoomValue(Number(event.target.value)))
                    }
                    className="w-full accent-brand-bar"
                  />
                  <span className="w-12 text-right text-xs text-muted-foreground">
                    {teamSymbolZoom.toFixed(2)}x
                  </span>
                </div>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
                Horizontal centre
                <div className="flex items-center gap-3">
                  <span className="w-10 text-xs text-muted-foreground">Left</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={teamSymbolPositionX}
                    onChange={(event) =>
                      setTeamSymbolPositionX(getTeamLogoPositionValue(Number(event.target.value)))
                    }
                    className="w-full accent-brand-bar"
                  />
                  <span className="w-10 text-right text-xs text-muted-foreground">Right</span>
                </div>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
                Vertical centre
                <div className="flex items-center gap-3">
                  <span className="w-10 text-xs text-muted-foreground">Top</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={teamSymbolPositionY}
                    onChange={(event) =>
                      setTeamSymbolPositionY(getTeamLogoPositionValue(Number(event.target.value)))
                    }
                    className="w-full accent-brand-bar"
                  />
                  <span className="w-10 text-right text-xs text-muted-foreground">Bottom</span>
                </div>
              </label>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function LeagueSettingsPanel({
  league,
  memberCount,
  isAdmin,
  canAccessCompetitionRules,
  isActive,
  currentUserId,
}: {
  league: League;
  memberCount: number;
  isAdmin: boolean;
  canAccessCompetitionRules: boolean;
  isActive: boolean;
  currentUserId?: string;
}) {
  const [settings, setSettings] = useState<LeagueSettingsResponse>(() =>
    createFallbackLeagueSettings(league)
  );
  const [isLoading, setIsLoading] = useState(false);
  // Save stays off until the settings GET succeeds for this league, so the
  // fallback defaults can never be written over the real settings.
  const [loadState, setLoadState] = useState<{
    status: 'loading' | 'loaded' | 'failed';
    league: League;
  }>(() => ({ status: 'loading', league }));
  const [loadAttempt, setLoadAttempt] = useState(0);
  const settingsLoaded = loadState.status === 'loaded' && loadState.league === league;
  const settingsLoadFailed = loadState.status === 'failed' && loadState.league === league;
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<LeagueSettingsMessage | null>(null);
  const loadGenerationRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const saveAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSettings(createFallbackLeagueSettings(league));
  }, [league]);

  useEffect(() => {
    if (!isActive || !isAdmin) return;

    const controller = new AbortController();
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    saveAbortControllerRef.current?.abort();
    saveAbortControllerRef.current = null;
    saveGenerationRef.current += 1;
    setIsSaving(false);
    async function loadLeagueSettings() {
      try {
        setIsLoading(true);
        setLoadState({ status: 'loading', league });
        setMessage(null);
        const response = await authenticatedFetch(
          `/api/leagues/${league.id}/settings`,
          { signal: controller.signal },
          currentUserId
        );
        const payload = await response.json();

        if (!response.ok || !payload.success) {
          throw new Error(payload.error ?? `status ${response.status}`);
        }

        if (controller.signal.aborted || generation !== loadGenerationRef.current) return;
        setSettings(normalizeLeagueSettingsPayload(payload.data, league));
        setLoadState({ status: 'loaded', league });
      } catch (error) {
        if (
          controller.signal.aborted ||
          generation !== loadGenerationRef.current ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }
        setLoadState({ status: 'failed', league });
      } finally {
        if (!controller.signal.aborted && generation === loadGenerationRef.current) {
          setIsLoading(false);
        }
      }
    }

    void loadLeagueSettings();
    return () => {
      controller.abort();
      if (generation === loadGenerationRef.current) loadGenerationRef.current += 1;
      saveAbortControllerRef.current?.abort();
      saveGenerationRef.current += 1;
    };
  }, [currentUserId, isActive, isAdmin, league, loadAttempt]);

  const updateLeagueSettings = (updates: Partial<LeagueSettingsResponse['league']>) => {
    setSettings((current) => ({
      ...current,
      league: { ...current.league, ...updates },
    }));
  };

  const updateDraftSettings = (updates: Partial<LeagueSettingsResponse['draft']>) => {
    setSettings((current) => ({
      ...current,
      draft: { ...current.draft, ...updates },
    }));
  };

  const updatePositionLimit = (key: PositionLimitKey, value: number) => {
    setSettings((current) => ({
      ...current,
      roster: {
        ...current.roster,
        positionLimits: {
          ...current.roster.positionLimits,
          [key]: value,
        },
      },
    }));
  };

  const updateAutoPickRules = (updates: Partial<DraftAutoPickRules>) => {
    setSettings((current) => ({
      ...current,
      draft: {
        ...current.draft,
        autoPickRules: { ...current.draft.autoPickRules, ...updates },
      },
    }));
  };

  const handleSaveSettings = async () => {
    if (!isAdmin) return;
    if (!settingsLoaded) return;

    const controller = new AbortController();
    const generation = saveGenerationRef.current + 1;
    saveGenerationRef.current = generation;
    saveAbortControllerRef.current?.abort();
    saveAbortControllerRef.current = controller;
    try {
      setIsSaving(true);
      setMessage(null);
      const response = await authenticatedFetch(
        `/api/leagues/${league.id}/settings`,
        {
          method: 'PUT',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        },
        currentUserId
      );
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? `status ${response.status}`);
      }

      if (controller.signal.aborted || generation !== saveGenerationRef.current) return;
      setSettings(normalizeLeagueSettingsPayload(payload.data, league));
      setMessage({ type: 'success', text: 'League settings saved.' });
    } catch (error) {
      if (
        controller.signal.aborted ||
        generation !== saveGenerationRef.current ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return;
      }
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save league settings.',
      });
    } finally {
      if (generation === saveGenerationRef.current) {
        if (saveAbortControllerRef.current === controller) saveAbortControllerRef.current = null;
        setIsSaving(false);
      }
    }
  };

  const formDisabled = !isAdmin || isSaving || !settingsLoaded;
  const draftStructureLock = settings.locks.draftStructure;
  const teamFillPercent = Math.min(100, Math.round((memberCount / settings.league.maxTeams) * 100));

  const updateFixtureGenerationMode = (fixtureGenerationMode: LeagueFixtureGenerationMode) => {
    setSettings((current) => ({
      ...current,
      scoring: { ...current.scoring, fixtureGenerationMode },
    }));
  };

  if (!isAdmin && canAccessCompetitionRules) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Competition Rules</h2>
          <p className="mt-1 text-sm text-muted-foreground">Co-commissioner controls</p>
        </div>
        <CompetitionSettingsPanel
          leagueId={league.id}
          currentUserId={currentUserId}
          fixtureGenerationMode={settings.scoring.fixtureGenerationMode}
          onFixtureGenerationModeChange={updateFixtureGenerationMode}
        />
      </div>
    );
  }

  const settingsHeader = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold text-foreground">League Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin ? 'Commissioner controls' : 'Read-only league settings'}
        </p>
      </div>
      {isLoading && (
        <span className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground">
          Loading
        </span>
      )}
    </div>
  );

  if (settingsLoadFailed) {
    return (
      <div className="flex flex-col gap-6">
        {settingsHeader}
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4"
        >
          <p className="text-sm font-semibold text-foreground">Settings could not load.</p>
          <p className="text-sm text-muted-foreground">
            Nothing has been changed. Try again to load this league&apos;s settings before editing
            them.
          </p>
          <div>
            <button
              type="button"
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {settingsHeader}

      {message && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-border bg-muted text-foreground'
              : 'border-destructive/20 bg-destructive/10 text-destructive-text'
          }`}
        >
          {message.text}
        </div>
      )}

      <fieldset disabled={formDisabled} className="flex flex-col gap-6 disabled:opacity-75">
        <section className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-base font-semibold text-foreground">Basic Information</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              League Name
              <input
                type="text"
                value={settings.league.name}
                onChange={(event) => updateLeagueSettings({ name: event.target.value })}
                className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar disabled:bg-muted"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              League Code
              <input
                type="text"
                value={settings.league.code}
                readOnly
                className="h-10 rounded-md border border-border bg-muted px-3 font-mono text-muted-foreground"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              Max Teams
              <input
                type="number"
                min={MIN_LEAGUE_TEAMS}
                max={MAX_LEAGUE_TEAMS}
                value={settings.league.maxTeams}
                onChange={(event) =>
                  updateLeagueSettings({
                    maxTeams: Number.parseInt(event.target.value, 10) || MIN_LEAGUE_TEAMS,
                  })
                }
                className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
              />
            </label>
            <SeasonYearControl leagueId={league.id} currentUserId={currentUserId} />
            <div className="flex flex-col gap-2 text-sm font-medium text-foreground">
              Team Count
              <div className="rounded-md border border-border bg-muted p-3">
                <div className="flex items-center justify-between text-sm">
                  <span>{memberCount} teams filled</span>
                  <span>{settings.league.maxTeams} max</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-brand-bar"
                    style={{ width: `${teamFillPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <ScoringSettingsPanel
          value={settings.scoring}
          lockReason={settings.locks.scoring}
          disabled={formDisabled}
          onChange={(scoring) => setSettings((current) => ({ ...current, scoring }))}
          format={settings.format}
          formatLockReason={draftStructureLock}
          onFormatChange={(format) =>
            setSettings((current) => ({
              ...current,
              format,
              // A Bloodsucker league runs rolling waivers with no FAAB (BR-03).
              ...(format.leagueFormat === 'BLOODSUCKER'
                ? {
                    waiver: { ...current.waiver, waiverRule: 'rolling' as const, faabBudget: null },
                  }
                : {}),
            }))
          }
        />

        <CompetitionSettingsPanel
          leagueId={league.id}
          currentUserId={currentUserId}
          fixtureGenerationMode={settings.scoring.fixtureGenerationMode}
          onFixtureGenerationModeChange={updateFixtureGenerationMode}
        />

        <section className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-base font-semibold text-foreground">Draft Settings</h3>
          {draftStructureLock && (
            <p className="mt-1 text-sm text-muted-foreground">{draftStructureLock}</p>
          )}
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              Draft Date
              <input
                type="datetime-local"
                value={toDateTimeLocalValue(settings.draft.draftDate)}
                onChange={(event) =>
                  updateDraftSettings({ draftDate: fromDateTimeLocalValue(event.target.value) })
                }
                className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              Draft Type
              <select
                value={settings.draft.draftType}
                disabled={Boolean(draftStructureLock)}
                onChange={(event) =>
                  updateDraftSettings({
                    draftType: event.target.value as LeagueSettingsDraftType,
                  })
                }
                className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
              >
                <option value="snake">Snake</option>
                <option value="linear">Linear</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              Pick Order
              <select
                value={settings.draft.pickOrder}
                disabled={Boolean(draftStructureLock)}
                onChange={(event) =>
                  updateDraftSettings({ pickOrder: event.target.value as DraftPickOrderMode })
                }
                className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
              >
                <option value="random">Random</option>
                <option value="manual">Manual</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              Time Per Pick
              <select
                value={settings.draft.timePerPick}
                onChange={(event) =>
                  updateDraftSettings({
                    timePerPick: Number.parseInt(event.target.value, 10),
                  })
                }
                className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
              >
                {TIME_PER_PICK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              Time Zone
              <input
                type="text"
                value={settings.draft.timeZone}
                onChange={(event) => updateDraftSettings({ timeZone: event.target.value })}
                className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
              />
            </label>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-base font-semibold text-foreground">Roster Settings</h3>
          {draftStructureLock && (
            <p className="mt-1 text-sm text-muted-foreground">{draftStructureLock}</p>
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {POSITION_LIMIT_KEYS.map((key) => (
              <label key={key} className="flex flex-col gap-2 text-sm font-medium text-foreground">
                {POSITION_LIMIT_LABELS[key]}
                <input
                  type="number"
                  min={0}
                  max={key === 'BENCH' ? 20 : 30}
                  value={settings.roster.positionLimits[key]}
                  disabled={Boolean(draftStructureLock)}
                  onChange={(event) =>
                    updatePositionLimit(key, Number.parseInt(event.target.value, 10) || 0)
                  }
                  className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-base font-semibold text-foreground">Auto-Pick And Waivers</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="flex min-h-10 items-center gap-3 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={settings.draft.autoPickRules.enabled}
                onChange={(event) => updateAutoPickRules({ enabled: event.target.checked })}
                className="size-4 rounded border-border text-brand-bar focus:ring-brand-bar"
              />
              Enable Auto-Pick
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              Auto-Pick Strategy
              <select
                value={settings.draft.autoPickRules.strategy}
                onChange={(event) =>
                  updateAutoPickRules({
                    strategy: event.target.value as DraftAutoPickRules['strategy'],
                  })
                }
                className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
              >
                <option value="queue-first">Queue first</option>
                <option value="best-available">Best available</option>
                <option value="fill-positions">Fill positions</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              Waiver Rule
              <select
                value={settings.waiver.waiverRule}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    waiver: {
                      ...current.waiver,
                      waiverRule: event.target.value as LeagueSettingsWaiverRule,
                    },
                  }))
                }
                className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
              >
                <option value="weekly" disabled={settings.format.leagueFormat === 'BLOODSUCKER'}>
                  Weekly
                </option>
                <option value="rolling">Rolling</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-foreground">
              FAAB budget
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Off"
                disabled={settings.format.leagueFormat === 'BLOODSUCKER'}
                value={settings.waiver.faabBudget ?? ''}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    waiver: {
                      ...current.waiver,
                      // Empty means FAAB off; the API rejects anything that is not a whole number of at least 1.
                      faabBudget:
                        event.target.value === '' ? null : Number.parseInt(event.target.value, 10),
                    },
                  }))
                }
                className="h-10 rounded-md border border-border bg-field px-3 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar"
              />
              <span className="text-xs font-normal text-muted-foreground">
                Leave blank to use waiver priority order.
              </span>
            </label>
          </div>
        </section>
      </fieldset>

      {isAdmin && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleSaveSettings()}
            disabled={formDisabled}
            className="inline-flex h-10 items-center justify-center rounded-md bg-brand-bar px-4 text-sm font-semibold text-brand-bar-foreground transition hover:bg-brand-bar-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-bar disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Save league settings'}
          </button>
        </div>
      )}
    </div>
  );
}
