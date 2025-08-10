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
