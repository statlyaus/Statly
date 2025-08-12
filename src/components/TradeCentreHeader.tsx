'use client';

import type { Team as BaseTeam } from '@/types';

interface Team extends BaseTeam {
  name: string;
  manager?: string;
  logoUrl?: string; // optional – falls back to initials avatar
}

export type TradeCentreHeaderProps = {
  /** If you don’t have rich team objects yet, you can pass simple names – we’ll map to Team */
  teams: Array<string | Team>;
  leftTeam: string;
  rightTeam: string;
  onLeftChange: (team: string) => void;
  onRightChange: (team: string) => void;

  /** Tabs */
  activeTab: 'compare' | 'market';
  onTabChange: (tab: 'compare' | 'market') => void;
};

function _toTeam(x: string | Team): Team {
  if (typeof x === 'string') {
    return { id: x, name: x };
  }
  return x;
}

function _initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('');
}
