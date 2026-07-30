import type { CSSProperties } from 'react';
import {
  FANTASY_CATEGORIES,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';
import type { League, LeagueMember } from '@/types/leagues';
import {
  DEFAULT_TEAM_SYMBOL_ZOOM,
  MAX_TEAM_SYMBOL_ZOOM,
  MIN_TEAM_SYMBOL_ZOOM,
} from '@/lib/teamSymbol';

export const LEAGUE_CATEGORY_PRESET = [...REAL_DATA_NINE_CATEGORY_PRESET];
const FANTASY_CATEGORY_KEYS = new Set(Object.keys(FANTASY_CATEGORIES));

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeFantasyCategoryList(
  value: unknown,
  fallback: readonly FantasyCategoryKey[] = LEAGUE_CATEGORY_PRESET
): FantasyCategoryKey[] {
  if (!Array.isArray(value)) return [...fallback];

  const normalized = value
    .map(String)
    .filter((category): category is FantasyCategoryKey => FANTASY_CATEGORY_KEYS.has(category));

  return normalized.length > 0 ? normalized : [...fallback];
}

export function getLeagueMemberRoleLabel(member: LeagueMember, league: League): string {
  if (member.userId === league.ownerId || member.role?.toLowerCase() === 'owner') return 'Owner';
  if (member.role?.toLowerCase() === 'manager') return 'Manager';
  if (member.role?.toLowerCase() === 'commissioner') return 'Commissioner';
  return 'Member';
}

export function formatLeagueMemberJoinedAt(value: string): string {
  if (!value) return 'Not recorded';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not recorded';

  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

export function getTeamInitials(teamName: string): string {
  const initials = teamName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

  return initials || 'T';
}

export function getTeamLogoPositionValue(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 50;
}

export function getTeamLogoZoomValue(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(MIN_TEAM_SYMBOL_ZOOM, Math.min(MAX_TEAM_SYMBOL_ZOOM, Math.round(value * 20) / 20))
    : DEFAULT_TEAM_SYMBOL_ZOOM;
}

function getTeamLogoObjectPosition(
  member: Pick<LeagueMember, 'teamLogoPositionX' | 'teamLogoPositionY'>
): string {
  return `${getTeamLogoPositionValue(member.teamLogoPositionX)}% ${getTeamLogoPositionValue(
    member.teamLogoPositionY
  )}%`;
}

export function getTeamLogoImageStyle(
  member: Pick<LeagueMember, 'teamLogoPositionX' | 'teamLogoPositionY' | 'teamLogoZoom'>
): CSSProperties {
  const objectPosition = getTeamLogoObjectPosition(member);
  const zoom = getTeamLogoZoomValue(member.teamLogoZoom);
  return {
    objectPosition,
    transform: `scale(${zoom})`,
    transformOrigin: objectPosition,
  };
}
