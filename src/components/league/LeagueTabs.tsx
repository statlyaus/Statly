'use client';

import React, { useState, useEffect, useCallback } from 'react';

import Link from 'next/link';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';

import { motion } from 'framer-motion';

import { useAuth } from '@/AuthContext';
import DraftManager from '@/components/league/DraftManager';
import LeagueMatchupTab from '@/components/league/LeagueMatchupTab';
import LeagueOverview from '@/components/league/LeagueOverview';
import LeagueSeasonTab from '@/components/league/LeagueSeasonTab';
import LeagueViewHeader from '@/components/league/LeagueViewHeader';
import LeagueWaiversTab from '@/components/league/LeagueWaiversTab';
import { listTrades } from '@/components/trades/tradeApi';
import { isTradeActive } from '@/components/trades/tradeUiUtils';
import MyTeamPanel from '@/components/MyTeamPanel';
import LeagueTradesClient from '@/components/trades/LeagueTradesClient';
import PlayersPageClient from '@/app/players/PlayersPageClient';
import { isAuthBypassEnabled } from '@/lib/authBypass';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';
import type {
  DraftType as LeagueDraftType,
  League,
  LeagueMember,
  LeagueType,
  WaiverPriorityMode,
  WaiverResetPolicy,
  WaiverSystem,
} from '@/types/leagues';
import type { Player, Team } from '@/types/players';

interface LeagueTabsProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
  onLeagueUpdate?: (nextLeague: League) => void;
}

type TabType =
  | 'overview'
  | 'matchup'
  | 'ladder'
  | 'schedule'
  | 'teams'
  | 'roster'
  | 'players'
  | 'trades'
  | 'waivers'
  | 'draft'
  | 'settings';

interface Tab {
  id: TabType;
  name: string;
  section: 'Play' | 'League' | 'Manage';
  description?: string;
  badge?: number;
}

const VALID_TABS: TabType[] = [
  'overview',
  'matchup',
  'ladder',
  'schedule',
  'teams',
  'roster',
  'players',
  'trades',
  'waivers',
  'draft',
  'settings',
];

function resolveActiveTab(tabParam: string | null | undefined): TabType {
  return VALID_TABS.includes(tabParam as TabType) ? (tabParam as TabType) : 'overview';
}

function toDateTimeLocalValue(value?: string | null): string {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export default function LeagueTabs({
  league,
  members,
  currentUserId,
  onLeagueUpdate,
}: LeagueTabsProps): React.ReactElement {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const [pendingIncomingTrades, setPendingIncomingTrades] = useState(0);
  const [savedLeagueName, setSavedLeagueName] = useState(league.name);
  const [savedLeagueType, setSavedLeagueType] = useState<LeagueType>(league.type);
  const [savedDescription, setSavedDescription] = useState(league.description ?? '');
  const [savedMaxTeams, setSavedMaxTeams] = useState(league.maxTeams);
  const [savedDraftDate, setSavedDraftDate] = useState(toDateTimeLocalValue(league.draftDate));
  const [savedDraftType, setSavedDraftType] = useState<LeagueDraftType>('snake');
  const [savedTimePerPick, setSavedTimePerPick] = useState(120);
  const [savedAllowAutoPick, setSavedAllowAutoPick] = useState(league.draftSettings?.allowAutoPick ?? true);
  const [savedEnableReminders, setSavedEnableReminders] = useState(
    league.draftSettings?.enableReminders ?? true
  );
  const [savedRosterSize, setSavedRosterSize] = useState(league.rosterSettings?.rosterSize ?? 18);
  const [savedBenchSize, setSavedBenchSize] = useState(league.rosterSettings?.benchSize ?? 4);
  const [savedEnableCaptainSystem, setSavedEnableCaptainSystem] = useState(
    league.captainSettings?.enableCaptainSystem ?? false
  );
  const [savedCaptainMultiplier, setSavedCaptainMultiplier] = useState(
    league.captainSettings?.captainMultiplier ?? 2
  );
  const [savedViceCaptainMultiplier, setSavedViceCaptainMultiplier] = useState(
    league.captainSettings?.viceCaptainMultiplier ?? 1.5
  );
  const [savedSeasonWeeks, setSavedSeasonWeeks] = useState(league.seasonSettings?.seasonWeeks ?? 12);
  const [savedMatchupsPerOpponent, setSavedMatchupsPerOpponent] = useState<1 | 2>(
    league.seasonSettings?.matchupsPerOpponent ?? 1
  );
  const [savedPlayoffsEnabled, setSavedPlayoffsEnabled] = useState(
    league.seasonSettings?.playoffsEnabled ?? false
  );
  const [savedPlayoffTeams, setSavedPlayoffTeams] = useState(league.seasonSettings?.playoffTeams ?? 0);
  const [savedPlayoffLegLengthWeeks, setSavedPlayoffLegLengthWeeks] = useState(
    league.seasonSettings?.playoffLegLengthWeeks ?? 1
  );
  const [savedPlayoffReseedEachRound, setSavedPlayoffReseedEachRound] = useState(
    league.seasonSettings?.playoffReseedEachRound ?? false
  );
  const [savedPlayoffIncludeConsolation, setSavedPlayoffIncludeConsolation] = useState(
    league.seasonSettings?.playoffIncludeConsolation ?? false
  );
  const [savedTradeLimit, setSavedTradeLimit] = useState(league.tradeSettings.tradeLimit);
  const [savedTradeReview, setSavedTradeReview] = useState(league.tradeSettings.tradeReview);
  const [savedTradeDeadline, setSavedTradeDeadline] = useState(
    league.tradeSettings.tradeDeadline?.slice(0, 10) ?? ''
  );
  const [savedWaiverPeriodHours, setSavedWaiverPeriodHours] = useState(league.waiverWire.waiverPeriodHours ?? 24);
  const [savedWaiverResetPolicy, setSavedWaiverResetPolicy] = useState<WaiverResetPolicy>(
    league.waiverWire.waiverResetPolicy
  );
  const [savedWaiverSystem, setSavedWaiverSystem] = useState<WaiverSystem>(
    league.waiverWire.waiverSystem ?? 'ROLLING_LIST'
  );
  const [savedWaiverPriorityMode, setSavedWaiverPriorityMode] = useState<WaiverPriorityMode>(
    league.waiverWire.waiverPriorityMode ?? 'ROLLING'
  );
  const [savedWaiverFaabBudget, setSavedWaiverFaabBudget] = useState(
    league.waiverWire.waiverFaabBudget ?? 100
  );
  const [savedWaiverMinimumBid, setSavedWaiverMinimumBid] = useState(
    league.waiverWire.waiverMinimumBid ?? 0
  );
  const [savedWaiverMaxWeekAcquisitions, setSavedWaiverMaxWeekAcquisitions] = useState(
    league.waiverWire.waiverMaxWeekAcquisitions?.toString() ?? ''
  );
  const [savedWaiverMaxSeasonAcquisitions, setSavedWaiverMaxSeasonAcquisitions] = useState(
    league.waiverWire.waiverMaxSeasonAcquisitions?.toString() ?? ''
  );
  const [savedWaiverMoveWinnerToBack, setSavedWaiverMoveWinnerToBack] = useState(
    league.waiverWire.waiverMoveWinnerToBack ?? true
  );
  const [savedWaiverAcquisitionLocked, setSavedWaiverAcquisitionLocked] = useState(
    league.waiverWire.waiverAcquisitionLocked ?? false
  );
  const [savedCantDropList, setSavedCantDropList] = useState(
    (league.waiverWire.cantDropList ?? []).join('\n')
  );
  const [savedCategories, setSavedCategories] = useState<FantasyCategoryKey[]>(league.categories);
  const [setupLeagueName, setSetupLeagueName] = useState(savedLeagueName);
  const [setupLeagueType, setSetupLeagueType] = useState<LeagueType>(savedLeagueType);
  const [setupDescription, setSetupDescription] = useState(savedDescription);
  const [setupMaxTeams, setSetupMaxTeams] = useState(savedMaxTeams);
  const [setupRegenerateInviteCode, setSetupRegenerateInviteCode] = useState(false);
  const [setupDraftDate, setSetupDraftDate] = useState(savedDraftDate);
  const [setupDraftType, setSetupDraftType] = useState<LeagueDraftType>(savedDraftType);
  const [setupTimePerPick, setSetupTimePerPick] = useState(savedTimePerPick);
  const [setupAllowAutoPick, setSetupAllowAutoPick] = useState(savedAllowAutoPick);
  const [setupEnableReminders, setSetupEnableReminders] = useState(savedEnableReminders);
  const [setupRosterSize, setSetupRosterSize] = useState(savedRosterSize);
  const [setupBenchSize, setSetupBenchSize] = useState(savedBenchSize);
  const [setupEnableCaptainSystem, setSetupEnableCaptainSystem] = useState(savedEnableCaptainSystem);
  const [setupCaptainMultiplier, setSetupCaptainMultiplier] = useState(savedCaptainMultiplier);
  const [setupViceCaptainMultiplier, setSetupViceCaptainMultiplier] = useState(
    savedViceCaptainMultiplier
  );
  const [setupSeasonWeeks, setSetupSeasonWeeks] = useState(savedSeasonWeeks);
  const [setupMatchupsPerOpponent, setSetupMatchupsPerOpponent] = useState<1 | 2>(
    savedMatchupsPerOpponent
  );
  const [setupPlayoffsEnabled, setSetupPlayoffsEnabled] = useState(savedPlayoffsEnabled);
  const [setupPlayoffTeams, setSetupPlayoffTeams] = useState(savedPlayoffTeams);
  const [setupPlayoffLegLengthWeeks, setSetupPlayoffLegLengthWeeks] = useState(
    savedPlayoffLegLengthWeeks
  );
  const [setupPlayoffReseedEachRound, setSetupPlayoffReseedEachRound] = useState(
    savedPlayoffReseedEachRound
  );
  const [setupPlayoffIncludeConsolation, setSetupPlayoffIncludeConsolation] = useState(
    savedPlayoffIncludeConsolation
  );
  const [setupTradeLimit, setSetupTradeLimit] = useState(savedTradeLimit);
  const [setupTradeReview, setSetupTradeReview] = useState(savedTradeReview);
  const [setupTradeDeadline, setSetupTradeDeadline] = useState(savedTradeDeadline);
  const [setupWaiverPeriodHours, setSetupWaiverPeriodHours] = useState(savedWaiverPeriodHours);
  const [setupWaiverResetPolicy, setSetupWaiverResetPolicy] = useState<WaiverResetPolicy>(
    savedWaiverResetPolicy
  );
  const [setupWaiverSystem, setSetupWaiverSystem] = useState<WaiverSystem>(savedWaiverSystem);
  const [setupWaiverPriorityMode, setSetupWaiverPriorityMode] = useState<WaiverPriorityMode>(
    savedWaiverPriorityMode
  );
  const [setupWaiverFaabBudget, setSetupWaiverFaabBudget] = useState(savedWaiverFaabBudget);
  const [setupWaiverMinimumBid, setSetupWaiverMinimumBid] = useState(savedWaiverMinimumBid);
  const [setupWaiverMaxWeekAcquisitions, setSetupWaiverMaxWeekAcquisitions] = useState(
    savedWaiverMaxWeekAcquisitions
  );
  const [setupWaiverMaxSeasonAcquisitions, setSetupWaiverMaxSeasonAcquisitions] = useState(
    savedWaiverMaxSeasonAcquisitions
  );
  const [setupWaiverMoveWinnerToBack, setSetupWaiverMoveWinnerToBack] = useState(
    savedWaiverMoveWinnerToBack
  );
  const [setupWaiverAcquisitionLocked, setSetupWaiverAcquisitionLocked] = useState(
    savedWaiverAcquisitionLocked
  );
  const [setupCantDropList, setSetupCantDropList] = useState(savedCantDropList);
  const [editableCategories, setEditableCategories] = useState<FantasyCategoryKey[]>(savedCategories);
  const [savingSettings, setSavingSettings] = useState(false);
  const [updatingMemberRole, setUpdatingMemberRole] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const activeTab = resolveActiveTab(searchParams?.get('tab'));

  useEffect(() => {
    const nextDraftDate = toDateTimeLocalValue(league.draftDate);
    const nextDescription = league.description ?? '';
    const nextMaxTeams = league.maxTeams;
    const nextTradeDeadline = league.tradeSettings.tradeDeadline?.slice(0, 10) ?? '';
    const nextWaiverPeriodHours = league.waiverWire.waiverPeriodHours ?? 24;
    const nextWaiverSystem = league.waiverWire.waiverSystem ?? 'ROLLING_LIST';
    const nextWaiverPriorityMode = league.waiverWire.waiverPriorityMode ?? 'ROLLING';
    const nextWaiverFaabBudget = league.waiverWire.waiverFaabBudget ?? 100;
    const nextWaiverMinimumBid = league.waiverWire.waiverMinimumBid ?? 0;
    const nextWaiverMaxWeekAcquisitions = league.waiverWire.waiverMaxWeekAcquisitions?.toString() ?? '';
    const nextWaiverMaxSeasonAcquisitions = league.waiverWire.waiverMaxSeasonAcquisitions?.toString() ?? '';
    const nextWaiverMoveWinnerToBack = league.waiverWire.waiverMoveWinnerToBack ?? true;
    const nextWaiverAcquisitionLocked = league.waiverWire.waiverAcquisitionLocked ?? false;
    const nextCantDropList = (league.waiverWire.cantDropList ?? []).join('\n');
    const nextRosterSize = league.rosterSettings?.rosterSize ?? 18;
    const nextBenchSize = league.rosterSettings?.benchSize ?? 4;
    const nextAllowAutoPick = league.draftSettings?.allowAutoPick ?? true;
    const nextEnableReminders = league.draftSettings?.enableReminders ?? true;
    const nextEnableCaptainSystem = league.captainSettings?.enableCaptainSystem ?? false;
    const nextCaptainMultiplier = league.captainSettings?.captainMultiplier ?? 2;
    const nextViceCaptainMultiplier = league.captainSettings?.viceCaptainMultiplier ?? 1.5;
    const nextSeasonWeeks = league.seasonSettings?.seasonWeeks ?? 12;
    const nextMatchupsPerOpponent = league.seasonSettings?.matchupsPerOpponent ?? 1;
    const nextPlayoffsEnabled = league.seasonSettings?.playoffsEnabled ?? false;
    const nextPlayoffTeams = league.seasonSettings?.playoffTeams ?? 0;
    const nextPlayoffLegLengthWeeks = league.seasonSettings?.playoffLegLengthWeeks ?? 1;
    const nextPlayoffReseedEachRound = league.seasonSettings?.playoffReseedEachRound ?? false;
    const nextPlayoffIncludeConsolation =
      league.seasonSettings?.playoffIncludeConsolation ?? false;

    setSavedLeagueName(league.name);
    setSavedLeagueType(league.type);
    setSavedDescription(nextDescription);
    setSavedMaxTeams(nextMaxTeams);
    setSavedCategories(league.categories);
    setSavedDraftDate(nextDraftDate);
    setSavedAllowAutoPick(nextAllowAutoPick);
    setSavedEnableReminders(nextEnableReminders);
    setSavedRosterSize(nextRosterSize);
    setSavedBenchSize(nextBenchSize);
    setSavedEnableCaptainSystem(nextEnableCaptainSystem);
    setSavedCaptainMultiplier(nextCaptainMultiplier);
    setSavedViceCaptainMultiplier(nextViceCaptainMultiplier);
    setSavedSeasonWeeks(nextSeasonWeeks);
    setSavedMatchupsPerOpponent(nextMatchupsPerOpponent);
    setSavedPlayoffsEnabled(nextPlayoffsEnabled);
    setSavedPlayoffTeams(nextPlayoffTeams);
    setSavedPlayoffLegLengthWeeks(nextPlayoffLegLengthWeeks);
    setSavedPlayoffReseedEachRound(nextPlayoffReseedEachRound);
    setSavedPlayoffIncludeConsolation(nextPlayoffIncludeConsolation);
    setSavedTradeLimit(league.tradeSettings.tradeLimit);
    setSavedTradeReview(league.tradeSettings.tradeReview);
    setSavedTradeDeadline(nextTradeDeadline);
    setSavedWaiverPeriodHours(nextWaiverPeriodHours);
    setSavedWaiverResetPolicy(league.waiverWire.waiverResetPolicy);
    setSavedWaiverSystem(nextWaiverSystem);
    setSavedWaiverPriorityMode(nextWaiverPriorityMode);
    setSavedWaiverFaabBudget(nextWaiverFaabBudget);
    setSavedWaiverMinimumBid(nextWaiverMinimumBid);
    setSavedWaiverMaxWeekAcquisitions(nextWaiverMaxWeekAcquisitions);
    setSavedWaiverMaxSeasonAcquisitions(nextWaiverMaxSeasonAcquisitions);
    setSavedWaiverMoveWinnerToBack(nextWaiverMoveWinnerToBack);
    setSavedWaiverAcquisitionLocked(nextWaiverAcquisitionLocked);
    setSavedCantDropList(nextCantDropList);
    setSetupLeagueName(league.name);
    setSetupLeagueType(league.type);
    setSetupDescription(nextDescription);
    setSetupMaxTeams(nextMaxTeams);
    setSetupRegenerateInviteCode(false);
    setEditableCategories(league.categories);
    setSetupDraftDate(nextDraftDate);
    setSetupAllowAutoPick(nextAllowAutoPick);
    setSetupEnableReminders(nextEnableReminders);
    setSetupRosterSize(nextRosterSize);
    setSetupBenchSize(nextBenchSize);
    setSetupEnableCaptainSystem(nextEnableCaptainSystem);
    setSetupCaptainMultiplier(nextCaptainMultiplier);
    setSetupViceCaptainMultiplier(nextViceCaptainMultiplier);
    setSetupSeasonWeeks(nextSeasonWeeks);
    setSetupMatchupsPerOpponent(nextMatchupsPerOpponent);
    setSetupPlayoffsEnabled(nextPlayoffsEnabled);
    setSetupPlayoffTeams(nextPlayoffTeams);
    setSetupPlayoffLegLengthWeeks(nextPlayoffLegLengthWeeks);
    setSetupPlayoffReseedEachRound(nextPlayoffReseedEachRound);
    setSetupPlayoffIncludeConsolation(nextPlayoffIncludeConsolation);
    setSetupTradeLimit(league.tradeSettings.tradeLimit);
    setSetupTradeReview(league.tradeSettings.tradeReview);
    setSetupTradeDeadline(nextTradeDeadline);
    setSetupWaiverPeriodHours(nextWaiverPeriodHours);
    setSetupWaiverResetPolicy(league.waiverWire.waiverResetPolicy);
    setSetupWaiverSystem(nextWaiverSystem);
    setSetupWaiverPriorityMode(nextWaiverPriorityMode);
    setSetupWaiverFaabBudget(nextWaiverFaabBudget);
    setSetupWaiverMinimumBid(nextWaiverMinimumBid);
    setSetupWaiverMaxWeekAcquisitions(nextWaiverMaxWeekAcquisitions);
    setSetupWaiverMaxSeasonAcquisitions(nextWaiverMaxSeasonAcquisitions);
    setSetupWaiverMoveWinnerToBack(nextWaiverMoveWinnerToBack);
    setSetupWaiverAcquisitionLocked(nextWaiverAcquisitionLocked);
    setSetupCantDropList(nextCantDropList);
    setSettingsMessage(null);
  }, [
    league.id,
    league.name,
    league.type,
    league.description,
    league.maxTeams,
    league.categories,
    league.draftDate,
    league.draftSettings?.allowAutoPick,
    league.draftSettings?.enableReminders,
    league.tradeSettings.tradeLimit,
    league.tradeSettings.tradeReview,
    league.tradeSettings.tradeDeadline,
    league.waiverWire.waiverPeriodHours,
    league.waiverWire.waiverResetPolicy,
    league.waiverWire.waiverSystem,
    league.waiverWire.waiverPriorityMode,
    league.waiverWire.waiverFaabBudget,
    league.waiverWire.waiverMinimumBid,
    league.waiverWire.waiverMaxWeekAcquisitions,
    league.waiverWire.waiverMaxSeasonAcquisitions,
    league.waiverWire.waiverMoveWinnerToBack,
    league.waiverWire.waiverAcquisitionLocked,
    league.waiverWire.cantDropList,
    league.rosterSettings?.rosterSize,
    league.rosterSettings?.benchSize,
    league.captainSettings?.enableCaptainSystem,
    league.captainSettings?.captainMultiplier,
    league.captainSettings?.viceCaptainMultiplier,
    league.seasonSettings?.seasonWeeks,
    league.seasonSettings?.matchupsPerOpponent,
    league.seasonSettings?.playoffsEnabled,
    league.seasonSettings?.playoffTeams,
    league.seasonSettings?.playoffLegLengthWeeks,
    league.seasonSettings?.playoffReseedEachRound,
    league.seasonSettings?.playoffIncludeConsolation,
  ]);

  useEffect(() => {
    let cancelled = false;

    const loadDraftSettings = async () => {
      try {
        const response = await fetch(`/api/leagues/${league.id}/draft-settings`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) return;

        const payload = (await response.json().catch(() => null)) as
          | {
              data?: {
                draftDate?: string;
                draftType?: 'snake' | 'linear';
                timePerPick?: number;
                allowAutoPick?: boolean;
                enableReminders?: boolean;
                rosterSize?: number;
                benchSize?: number;
              };
            }
          | null;

        if (cancelled || !payload?.data) return;

        const nextDraftDate = toDateTimeLocalValue(payload.data.draftDate);
        const nextDraftType = payload.data.draftType ?? 'snake';
        const nextTimePerPick = payload.data.timePerPick ?? 120;
        const nextAllowAutoPick = payload.data.allowAutoPick ?? league.draftSettings?.allowAutoPick ?? true;
        const nextEnableReminders =
          payload.data.enableReminders ?? league.draftSettings?.enableReminders ?? true;
        const nextRosterSize = payload.data.rosterSize ?? league.rosterSettings?.rosterSize ?? 18;
        const nextBenchSize = payload.data.benchSize ?? league.rosterSettings?.benchSize ?? 4;
        setSavedDraftDate(nextDraftDate);
        setSavedDraftType(nextDraftType);
        setSavedTimePerPick(nextTimePerPick);
        setSavedAllowAutoPick(nextAllowAutoPick);
        setSavedEnableReminders(nextEnableReminders);
        setSavedRosterSize(nextRosterSize);
        setSavedBenchSize(nextBenchSize);
        setSetupDraftDate(nextDraftDate);
        setSetupDraftType(nextDraftType);
        setSetupTimePerPick(nextTimePerPick);
        setSetupAllowAutoPick(nextAllowAutoPick);
        setSetupEnableReminders(nextEnableReminders);
        setSetupRosterSize(nextRosterSize);
        setSetupBenchSize(nextBenchSize);
      } catch {
        if (!cancelled) {
          setSetupDraftType('snake');
        }
      }
    };

    void loadDraftSettings();

    return () => {
      cancelled = true;
    };
  }, [league.id]);

  useEffect(() => {
    let mounted = true;
    if (!currentUserId) {
      setPendingIncomingTrades(0);
      return;
    }

    const loadTradesBadge = async () => {
      try {
        const trades = await listTrades(league.id);
        if (!mounted) return;
        const count = trades.filter(
          (trade) => isTradeActive(trade) && trade.recipientUserId === currentUserId
        ).length;
        setPendingIncomingTrades(count);
      } catch (_error) {
        if (mounted) setPendingIncomingTrades(0);
      }
    };

    void loadTradesBadge();
    return () => {
      mounted = false;
    };
  }, [league.id, currentUserId, activeTab]);

  const tabs: Tab[] = [
    { id: 'overview', name: 'Overview', section: 'Play', description: 'Snapshot of your league right now' },
    { id: 'matchup', name: 'Matchup', section: 'Play', description: 'Live and historical head-to-head results' },
    { id: 'roster', name: 'My Roster', section: 'Play', description: 'Manage your lineup and squad' },
    { id: 'players', name: 'Players', section: 'Play', description: 'League player pool and ownership context' },
    { id: 'waivers', name: 'Waivers', section: 'Play', description: 'Claims, priority, and processing' },
    {
      id: 'trades',
      name: 'Trades',
      section: 'Play',
      description: 'Offers, incoming requests, and negotiations',
      badge: pendingIncomingTrades > 0 ? pendingIncomingTrades : undefined,
    },
    { id: 'ladder', name: 'Ladder', section: 'League', description: 'Standings, points, and category totals' },
    { id: 'schedule', name: 'Schedule', section: 'League', description: 'Round-by-round league calendar and history' },
    { id: 'teams', name: 'Teams', section: 'League', description: 'Every club in the league and roster access' },
    { id: 'draft', name: 'Draft', section: 'Manage', description: 'Draft room, board, and settings' },
    { id: 'settings', name: 'Settings', section: 'Manage', description: 'League rules and configuration' },
  ];
  const activeTabMeta = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const buildTabHref = (tabId: TabType) => `${pathname}?tab=${tabId}`;
  const groupedTabs: Array<{ title: Tab['section']; tabs: Tab[] }> = [
    { title: 'Play', tabs: tabs.filter((tab) => tab.section === 'Play') },
    { title: 'League', tabs: tabs.filter((tab) => tab.section === 'League') },
    { title: 'Manage', tabs: tabs.filter((tab) => tab.section === 'Manage') },
  ];
  const jumpMap: Record<TabType, TabType[]> = {
    overview: ['matchup', 'roster', 'ladder'],
    matchup: ['overview', 'roster', 'ladder'],
    ladder: ['overview', 'schedule', 'matchup'],
    schedule: ['overview', 'ladder', 'matchup'],
    teams: ['ladder', 'players', 'overview'],
    roster: ['matchup', 'players', 'waivers'],
    players: ['roster', 'waivers', 'trades'],
    trades: ['players', 'waivers', 'overview'],
    waivers: ['players', 'roster', 'overview'],
    draft: ['overview', 'players', 'settings'],
    settings: ['draft', 'overview', 'teams'],
  };
  const jumpTabs = jumpMap[activeTab]
    .map((tabId) => tabs.find((tab) => tab.id === tabId))
    .filter((tab): tab is Tab => Boolean(tab));

  const currentUserRole = members.find((m) => m.userId === currentUserId)?.role;
  const isOwner = currentUserRole === 'owner';
  const canManageLeague = currentUserRole === 'owner' || currentUserRole === 'commissioner';
  const canManageOwnerSettings = isOwner;
  const totalTeams = members.length;
  const maxTeams = league.maxTeams || 0;
  const openSlots = Math.max(0, maxTeams - totalTeams);
  const fillPercent = maxTeams > 0 ? Math.min(100, Math.round((totalTeams / maxTeams) * 100)) : 0;
  const assignedDraftSlots = members
    .map((member) => (member as LeagueMember & { draftSlot?: number }).draftSlot)
    .filter((draftSlot): draftSlot is number => typeof draftSlot === 'number')
    .sort((left, right) => left - right);
  const hasSavedDraftOrder =
    members.length > 0 &&
    assignedDraftSlots.length === members.length &&
    assignedDraftSlots.every((draftSlot, index) => draftSlot === index + 1);
  const roleBadgeClass = (role: LeagueMember['role']) => {
    if (role === 'owner') return 'bg-[color:var(--league-accent-soft)] text-[color:var(--league-accent)]';
    if (role === 'commissioner') return 'bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)]';
    if (role === 'manager') return 'bg-[color:var(--league-primary-soft)] text-[color:var(--league-primary)]';
    return 'bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)]';
  };
  const setupSteps = [
    {
      id: 'members',
      title: 'Invite managers',
      complete: totalTeams >= 4,
      detail:
        openSlots > 0
          ? `${openSlots} open ${openSlots === 1 ? 'slot remains' : 'slots remain'} before the league is full.`
          : 'League capacity is filled.',
    },
    {
      id: 'categories',
      title: 'Confirm scoring categories',
      complete: savedCategories.length > 0,
      detail:
        savedCategories.length > 0
          ? `${savedCategories.length} categories configured.`
          : 'No scoring categories configured yet.',
    },
    {
      id: 'schedule',
      title: 'Set draft date and clock',
      complete: Boolean(savedDraftDate),
      detail: savedDraftDate
        ? `Draft scheduled for ${new Date(savedDraftDate).toLocaleString('en-AU')}.`
        : 'Choose a draft date, time, and seconds per pick.',
    },
    {
      id: 'order',
      title: 'Assign draft order',
      complete: hasSavedDraftOrder,
      detail: hasSavedDraftOrder
        ? 'Draft slots are saved. Review or adjust them from the Draft tab before creating the draft.'
        : 'Set and save draft slots from the Draft tab before creating the draft.',
    },
  ];
  const hasCategoryChanges =
    editableCategories.length !== savedCategories.length ||
    editableCategories.some((category) => !savedCategories.includes(category));
  const hasSetupChanges =
    hasCategoryChanges ||
    setupLeagueName.trim() !== savedLeagueName ||
    setupLeagueType !== savedLeagueType ||
    setupDescription.trim() !== savedDescription ||
    setupMaxTeams !== savedMaxTeams ||
    setupRegenerateInviteCode ||
    setupDraftDate !== savedDraftDate ||
    setupDraftType !== savedDraftType ||
    setupTimePerPick !== savedTimePerPick ||
    setupAllowAutoPick !== savedAllowAutoPick ||
    setupEnableReminders !== savedEnableReminders ||
    setupRosterSize !== savedRosterSize ||
    setupBenchSize !== savedBenchSize ||
    setupEnableCaptainSystem !== savedEnableCaptainSystem ||
    setupCaptainMultiplier !== savedCaptainMultiplier ||
    setupViceCaptainMultiplier !== savedViceCaptainMultiplier ||
    setupSeasonWeeks !== savedSeasonWeeks ||
    setupMatchupsPerOpponent !== savedMatchupsPerOpponent ||
    setupPlayoffsEnabled !== savedPlayoffsEnabled ||
    setupPlayoffTeams !== savedPlayoffTeams ||
    setupPlayoffLegLengthWeeks !== savedPlayoffLegLengthWeeks ||
    setupPlayoffReseedEachRound !== savedPlayoffReseedEachRound ||
    setupPlayoffIncludeConsolation !== savedPlayoffIncludeConsolation ||
    setupTradeLimit !== savedTradeLimit ||
    setupTradeReview !== savedTradeReview ||
    setupTradeDeadline !== savedTradeDeadline ||
    setupWaiverPeriodHours !== savedWaiverPeriodHours ||
    setupWaiverResetPolicy !== savedWaiverResetPolicy ||
    setupWaiverSystem !== savedWaiverSystem ||
    setupWaiverPriorityMode !== savedWaiverPriorityMode ||
    setupWaiverFaabBudget !== savedWaiverFaabBudget ||
    setupWaiverMinimumBid !== savedWaiverMinimumBid ||
    setupWaiverMaxWeekAcquisitions !== savedWaiverMaxWeekAcquisitions ||
    setupWaiverMaxSeasonAcquisitions !== savedWaiverMaxSeasonAcquisitions ||
    setupWaiverMoveWinnerToBack !== savedWaiverMoveWinnerToBack ||
    setupWaiverAcquisitionLocked !== savedWaiverAcquisitionLocked ||
    setupCantDropList !== savedCantDropList;
  const toggleCategory = (category: FantasyCategoryKey) => {
    if (!canManageLeague) return;

    setEditableCategories((current) =>
      current.includes(category)
        ? current.filter((entry) => entry !== category)
        : [...current, category]
    );
    setSettingsMessage(null);
  };
  const saveLeagueSetup = async () => {
    if (!canManageLeague || savingSettings) return;
    if (editableCategories.length === 0) {
      setSettingsMessage('Select at least one scoring category.');
      return;
    }
    if (setupLeagueName.trim().length < 3) {
      setSettingsMessage('League name must be at least 3 characters.');
      return;
    }
    if (setupMaxTeams < members.length) {
      setSettingsMessage(`Max teams cannot be lower than the current member count (${members.length}).`);
      return;
    }
    if (setupBenchSize > setupRosterSize) {
      setSettingsMessage('Bench size cannot be greater than total roster size.');
      return;
    }
    if (setupViceCaptainMultiplier > setupCaptainMultiplier) {
      setSettingsMessage('Vice-captain multiplier cannot exceed captain multiplier.');
      return;
    }
    if (setupPlayoffsEnabled && setupPlayoffTeams < 2) {
      setSettingsMessage('Playoffs need at least 2 qualifying teams.');
      return;
    }
    if (setupPlayoffTeams > setupMaxTeams) {
      setSettingsMessage('Playoff teams cannot exceed the league size.');
      return;
    }
    if (setupWaiverSystem === 'FAAB' && setupWaiverFaabBudget < 1) {
      setSettingsMessage('FAAB leagues need a waiver budget greater than 0.');
      return;
    }
    const nextWaiverMaxWeekAcquisitions = setupWaiverMaxWeekAcquisitions.trim();
    const nextWaiverMaxSeasonAcquisitions = setupWaiverMaxSeasonAcquisitions.trim();
    const nextCantDropList = setupCantDropList
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);

    try {
      setSavingSettings(true);
      setSettingsMessage(null);
      const token = user && typeof user.getIdToken === 'function' ? await user.getIdToken() : null;
      const nextLeagueName = setupLeagueName.trim();
      const nextDescription = setupDescription.trim();
      const nextDraftDateIso = setupDraftDate ? new Date(setupDraftDate).toISOString() : undefined;
      const responsePayload = await fetch(`/api/leagues/${league.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: nextLeagueName,
          type: setupLeagueType,
          description: nextDescription || undefined,
          maxTeams: setupMaxTeams,
          regenerateInviteCode: setupRegenerateInviteCode || undefined,
          categories: editableCategories,
          draftDate: nextDraftDateIso,
          draftType: setupDraftType,
          timePerPick: setupTimePerPick,
          allowAutoPick: setupAllowAutoPick,
          enableReminders: setupEnableReminders,
          rosterSize: setupRosterSize,
          benchSize: setupBenchSize,
          enableCaptainSystem: setupEnableCaptainSystem,
          captainMultiplier: setupCaptainMultiplier,
          viceCaptainMultiplier: setupViceCaptainMultiplier,
          seasonWeeks: setupSeasonWeeks,
          matchupsPerOpponent: setupMatchupsPerOpponent,
          playoffsEnabled: setupPlayoffsEnabled,
          playoffTeams: setupPlayoffTeams,
          playoffLegLengthWeeks: setupPlayoffLegLengthWeeks,
          playoffReseedEachRound: setupPlayoffReseedEachRound,
          playoffIncludeConsolation: setupPlayoffIncludeConsolation,
          tradeLimit: setupTradeLimit,
          tradeReview: setupTradeReview,
          tradeDeadline: setupTradeDeadline || undefined,
          waiverPeriodHours: setupWaiverPeriodHours,
          waiverResetPolicy: setupWaiverResetPolicy,
          waiverSystem: setupWaiverSystem,
          waiverPriorityMode: setupWaiverPriorityMode,
          waiverFaabBudget: setupWaiverFaabBudget,
          waiverMinimumBid: setupWaiverMinimumBid,
          waiverMaxWeekAcquisitions: nextWaiverMaxWeekAcquisitions
            ? parseInt(nextWaiverMaxWeekAcquisitions, 10)
            : null,
          waiverMaxSeasonAcquisitions: nextWaiverMaxSeasonAcquisitions
            ? parseInt(nextWaiverMaxSeasonAcquisitions, 10)
            : null,
          waiverMoveWinnerToBack: setupWaiverMoveWinnerToBack,
          waiverAcquisitionLocked: setupWaiverAcquisitionLocked,
          cantDropList: nextCantDropList,
        }),
      });
      if (!responsePayload.ok) {
        const payload = (await responsePayload.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || 'Failed to save league setup');
      }
      const payload = (await responsePayload.json().catch(() => null)) as
        | { data?: { inviteCode?: string } }
        | null;

      setSavedLeagueName(nextLeagueName);
      setSavedLeagueType(setupLeagueType);
      setSavedDescription(nextDescription);
      setSavedMaxTeams(setupMaxTeams);
      const nextDraftDate = setupDraftDate;
      const nextDraftType = setupDraftType;
      const nextTimePerPick = setupTimePerPick;
      const nextAllowAutoPick = setupAllowAutoPick;
      const nextEnableReminders = setupEnableReminders;
      const nextRosterSize = setupRosterSize;
      const nextBenchSize = setupBenchSize;
      const nextEnableCaptainSystem = setupEnableCaptainSystem;
      const nextCaptainMultiplier = setupCaptainMultiplier;
      const nextViceCaptainMultiplier = setupViceCaptainMultiplier;
      const nextSeasonWeeks = setupSeasonWeeks;
      const nextMatchupsPerOpponent = setupMatchupsPerOpponent;
      const nextPlayoffsEnabled = setupPlayoffsEnabled;
      const nextPlayoffTeams = setupPlayoffTeams;
      const nextPlayoffLegLengthWeeks = setupPlayoffLegLengthWeeks;
      const nextPlayoffReseedEachRound = setupPlayoffReseedEachRound;
      const nextPlayoffIncludeConsolation = setupPlayoffIncludeConsolation;
      const nextTradeLimit = setupTradeLimit;
      const nextTradeReview = setupTradeReview;
      const nextTradeDeadline = setupTradeDeadline;
      const nextWaiverPeriodHours = setupWaiverPeriodHours;
      const nextWaiverResetPolicy = setupWaiverResetPolicy;
      const nextWaiverSystem = setupWaiverSystem;
      const nextWaiverPriorityMode = setupWaiverPriorityMode;
      const nextWaiverFaabBudget = setupWaiverFaabBudget;
      const nextWaiverMinimumBid = setupWaiverMinimumBid;
      const nextWaiverMaxWeekAcquisitionsValue = nextWaiverMaxWeekAcquisitions;
      const nextWaiverMaxSeasonAcquisitionsValue = nextWaiverMaxSeasonAcquisitions;
      const nextWaiverMoveWinnerToBack = setupWaiverMoveWinnerToBack;
      const nextWaiverAcquisitionLocked = setupWaiverAcquisitionLocked;
      const nextCantDropListValue = nextCantDropList.join('\n');
      const nextCategories = [...editableCategories];

      setSavedDraftDate(nextDraftDate);
      setSavedDraftType(nextDraftType);
      setSavedTimePerPick(nextTimePerPick);
      setSavedAllowAutoPick(nextAllowAutoPick);
      setSavedEnableReminders(nextEnableReminders);
      setSavedRosterSize(nextRosterSize);
      setSavedBenchSize(nextBenchSize);
      setSavedEnableCaptainSystem(nextEnableCaptainSystem);
      setSavedCaptainMultiplier(nextCaptainMultiplier);
      setSavedViceCaptainMultiplier(nextViceCaptainMultiplier);
      setSavedSeasonWeeks(nextSeasonWeeks);
      setSavedMatchupsPerOpponent(nextMatchupsPerOpponent);
      setSavedPlayoffsEnabled(nextPlayoffsEnabled);
      setSavedPlayoffTeams(nextPlayoffTeams);
      setSavedPlayoffLegLengthWeeks(nextPlayoffLegLengthWeeks);
      setSavedPlayoffReseedEachRound(nextPlayoffReseedEachRound);
      setSavedPlayoffIncludeConsolation(nextPlayoffIncludeConsolation);
      setSavedTradeLimit(nextTradeLimit);
      setSavedTradeReview(nextTradeReview);
      setSavedTradeDeadline(nextTradeDeadline);
      setSavedWaiverPeriodHours(nextWaiverPeriodHours);
      setSavedWaiverResetPolicy(nextWaiverResetPolicy);
      setSavedWaiverSystem(nextWaiverSystem);
      setSavedWaiverPriorityMode(nextWaiverPriorityMode);
      setSavedWaiverFaabBudget(nextWaiverFaabBudget);
      setSavedWaiverMinimumBid(nextWaiverMinimumBid);
      setSavedWaiverMaxWeekAcquisitions(nextWaiverMaxWeekAcquisitionsValue);
      setSavedWaiverMaxSeasonAcquisitions(nextWaiverMaxSeasonAcquisitionsValue);
      setSavedWaiverMoveWinnerToBack(nextWaiverMoveWinnerToBack);
      setSavedWaiverAcquisitionLocked(nextWaiverAcquisitionLocked);
      setSavedCantDropList(nextCantDropListValue);
      setSavedCategories(nextCategories);
      setSetupRegenerateInviteCode(false);
      onLeagueUpdate?.({
        ...league,
        code: payload?.data?.inviteCode ?? league.code,
        name: nextLeagueName,
        type: setupLeagueType,
        maxTeams: setupMaxTeams,
        description: nextDescription || undefined,
        categories: nextCategories,
        draftDate: nextDraftDateIso,
        draftSettings: {
          draftType: nextDraftType,
          timePerPick: nextTimePerPick,
          allowAutoPick: nextAllowAutoPick,
          enableReminders: nextEnableReminders,
        },
        tradeSettings: {
          ...league.tradeSettings,
          tradeLimit: nextTradeLimit,
          tradeReview: nextTradeReview,
          tradeDeadline: nextTradeDeadline || undefined,
        },
        waiverWire: {
          ...league.waiverWire,
          waiverPeriodHours: nextWaiverPeriodHours,
          waiverResetPolicy: nextWaiverResetPolicy,
          waiverSystem: nextWaiverSystem,
          waiverPriorityMode: nextWaiverPriorityMode,
          waiverFaabBudget: nextWaiverFaabBudget,
          waiverMinimumBid: nextWaiverMinimumBid,
          ...(nextWaiverMaxWeekAcquisitionsValue
            ? { waiverMaxWeekAcquisitions: parseInt(nextWaiverMaxWeekAcquisitionsValue, 10) }
            : { waiverMaxWeekAcquisitions: undefined }),
          ...(nextWaiverMaxSeasonAcquisitionsValue
            ? { waiverMaxSeasonAcquisitions: parseInt(nextWaiverMaxSeasonAcquisitionsValue, 10) }
            : { waiverMaxSeasonAcquisitions: undefined }),
          waiverMoveWinnerToBack: nextWaiverMoveWinnerToBack,
          waiverAcquisitionLocked: nextWaiverAcquisitionLocked,
          cantDropList: nextCantDropList,
        },
        rosterSettings: {
          rosterSize: nextRosterSize,
          benchSize: nextBenchSize,
        },
        captainSettings: {
          enableCaptainSystem: nextEnableCaptainSystem,
          captainMultiplier: nextCaptainMultiplier,
          viceCaptainMultiplier: nextViceCaptainMultiplier,
        },
        seasonSettings: {
          seasonWeeks: nextSeasonWeeks,
          matchupsPerOpponent: nextMatchupsPerOpponent,
          playoffsEnabled: nextPlayoffsEnabled,
          playoffTeams: nextPlayoffTeams,
          playoffLegLengthWeeks: nextPlayoffLegLengthWeeks,
          playoffReseedEachRound: nextPlayoffReseedEachRound,
          playoffIncludeConsolation: nextPlayoffIncludeConsolation,
        },
      });
      setSettingsMessage(
        setupRegenerateInviteCode ? 'League setup saved. A new invite code is now active.' : 'League setup saved.'
      );
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'Failed to save league setup');
    } finally {
      setSavingSettings(false);
    }
  };

  const updateMemberRole = async (
    targetUserId: string,
    role: Extract<LeagueMember['role'], 'commissioner' | 'manager'>
  ) => {
    if (!isOwner || updatingMemberRole) return;

    try {
      setUpdatingMemberRole(targetUserId);
      setSettingsMessage(null);
      const token = user && typeof user.getIdToken === 'function' ? await user.getIdToken() : null;
      const response = await fetch(`/api/leagues/${league.id}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: 'updateMember',
          targetUserId,
          updates: { role },
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Failed to update member role');
      }

      setSettingsMessage('Member role updated. Refreshing league members…');
      router.refresh();
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'Failed to update member role');
    } finally {
      setUpdatingMemberRole(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[32px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-4 shadow-[0_24px_60px_-45px_rgba(23,34,48,0.18)] xl:hidden">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[color:var(--league-text-muted)]">League workspace</p>
              <h1 className="mt-2 text-2xl font-semibold text-[color:var(--league-text)]">{league.name}</h1>
              <p className="mt-2 text-sm leading-6 text-[color:var(--league-text-muted)]">
                {activeTabMeta.section} • {activeTabMeta.name}. {activeTabMeta.description}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[color:var(--league-primary)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                {league.status}
              </span>
              <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--league-text-muted)]">
                {totalTeams}/{maxTeams} teams
              </span>
              <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--league-text-muted)]">
                {league.code}
              </span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">Active view</p>
              <p className="mt-1 text-base font-semibold text-[color:var(--league-text)]">{activeTabMeta.name}</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">League fill</p>
              <p className="mt-1 text-base font-semibold text-[color:var(--league-text)]">{fillPercent}% full</p>
            </div>
            <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">Open slots</p>
              <p className="mt-1 text-base font-semibold text-[color:var(--league-text)]">{openSlots}</p>
            </div>
          </div>
          <div className="-mx-4 overflow-x-auto px-4">
            <nav className="flex min-w-max gap-2 pb-1" aria-label="League tabs">
              {tabs.map((tab) => (
                <Link
                  key={tab.id}
                  href={buildTabHref(tab.id)}
                  aria-label={`Switch to ${tab.name} tab`}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition ${
                    activeTab === tab.id
                      ? 'border-[color:var(--league-primary)] bg-[color:var(--league-primary)] text-white shadow-sm'
                      : 'border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] text-[color:var(--league-text-muted)] hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]'
                  }`}
                >
                  <span>{tab.name}</span>
                  {tab.badge ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activeTab === tab.id ? 'bg-white/15 text-white' : 'bg-red-100 text-red-600'}`}>
                      {tab.badge}
                    </span>
                  ) : null}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex flex-wrap gap-2">
            {jumpTabs.map((tab) => (
              <Link
                key={tab.id}
                href={buildTabHref(tab.id)}
                className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-2 text-sm font-medium text-[color:var(--league-text-muted)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]"
              >
                {tab.name}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)] 2xl:gap-8">
        <aside className="hidden xl:block">
          <div className="sticky top-[calc(var(--app-toolbar-height)+1.5rem)] space-y-4">
            <div className="overflow-hidden rounded-[32px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] shadow-[0_24px_60px_-45px_rgba(23,34,48,0.18)]">
              <div className="border-b border-[color:var(--league-border)] px-5 py-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[color:var(--league-text-muted)]">League workspace</p>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[color:var(--league-text)]">{league.name}</h1>
                <p className="mt-3 text-sm leading-6 text-[color:var(--league-text-muted)]">
                  {activeTabMeta.section} view. {activeTabMeta.description}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full bg-[color:var(--league-primary)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                    {league.status}
                  </span>
                  <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--league-text-muted)]">
                    {totalTeams}/{maxTeams} teams
                  </span>
                  <span className="rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--league-text-muted)]">
                    {league.code}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 border-b border-[color:var(--league-border)] px-5 py-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">Current view</p>
                    <p className="mt-1 text-sm font-semibold text-[color:var(--league-text)]">{activeTabMeta.name}</p>
                  </div>
                  <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">League fill</p>
                    <p className="mt-1 text-sm font-semibold text-[color:var(--league-text)]">{fillPercent}%</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">Open slots</p>
                    <p className="mt-1 text-sm font-semibold text-[color:var(--league-text)]">{openSlots}</p>
                  </div>
                  <div className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">Pending trades</p>
                    <p className="mt-1 text-sm font-semibold text-[color:var(--league-text)]">{pendingIncomingTrades}</p>
                  </div>
                </div>
              </div>

              <div className="px-3 py-3">
                {groupedTabs.map((group) => (
                  <div key={group.title} className="mb-3 last:mb-0">
                    <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--league-text-muted)]">
                      {group.title}
                    </p>
                    <div className="space-y-1">
                      {group.tabs.map((tab) => (
                        <Link
                          key={tab.id}
                          href={buildTabHref(tab.id)}
                          aria-label={`Switch to ${tab.name} tab`}
                          aria-current={activeTab === tab.id ? 'page' : undefined}
                          className={`flex items-start justify-between gap-3 rounded-2xl px-3 py-3 text-sm transition ${
                            activeTab === tab.id
                              ? 'border border-[color:var(--league-primary)] bg-[color:var(--league-primary)] text-white shadow-sm'
                              : 'border border-transparent text-[color:var(--league-text-muted)] hover:border-[color:var(--league-border)] hover:bg-[color:var(--league-surface-muted)] hover:text-[color:var(--league-text)]'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-medium">{tab.name}</p>
                            <p className={`mt-1 text-xs leading-5 ${activeTab === tab.id ? 'text-white/72' : 'text-[color:var(--league-text-muted)]'}`}>
                              {tab.description}
                            </p>
                          </div>
                          {tab.badge ? (
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${activeTab === tab.id ? 'bg-white/15 text-white' : 'bg-red-100 text-red-600'}`}>
                              {tab.badge}
                            </span>
                          ) : null}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-[color:var(--league-border)] bg-[color:var(--league-page)] px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                  Recommended next
                </p>
                <div className="mt-3 space-y-2">
                  {jumpTabs.map((tab) => (
                    <Link
                      key={tab.id}
                      href={buildTabHref(tab.id)}
                      className="flex items-center justify-between rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface)] px-3 py-3 text-sm font-medium text-[color:var(--league-text-muted)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)] hover:text-[color:var(--league-text)]"
                    >
                      <span>{tab.name}</span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'overview' && (
              <LeagueOverview league={league} members={members} currentUserId={currentUserId} />
            )}

            {activeTab === 'matchup' && (
              <LeagueMatchupTab leagueId={league.id} categories={league.categories} embedded />
            )}

            {activeTab === 'ladder' && (
              <LeagueSeasonTab leagueId={league.id} initialPanel="ladder" embedded />
            )}

            {activeTab === 'schedule' && (
              <LeagueSeasonTab leagueId={league.id} initialPanel="schedule" embedded />
            )}

            {activeTab === 'teams' && (
              <LeagueTabFrame
                eyebrow="League directory"
                title="Teams and managers"
                description="See every club in the competition, who manages it, and how full the league is without dropping into a different page style."
                aside={
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Teams</p>
                      <p className="mt-1 text-lg font-semibold text-[color:var(--league-text)]">{totalTeams}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Capacity</p>
                      <p className="mt-1 text-lg font-semibold text-[color:var(--league-text)]">{fillPercent}% full</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Open slots</p>
                      <p className="mt-1 text-lg font-semibold text-[color:var(--league-text)]">{openSlots}</p>
                    </div>
                  </div>
                }
              >
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>League capacity</span>
                    <span>{fillPercent}% full</span>
                  </div>
                  <div className="mt-2 h-2.5 w-full rounded-full bg-slate-100">
                    <div
                      className="h-2.5 rounded-full bg-[linear-gradient(90deg,var(--league-primary)_0%,var(--league-accent)_100%)]"
                      style={{ width: `${fillPercent}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="group rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[color:var(--league-accent)] hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--league-primary)] text-sm font-semibold text-white">
                            {member.teamName
                              .split(' ')
                              .map((word) => word.charAt(0))
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()}
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Team</p>
                            <h3 className="mt-1 text-lg font-semibold text-[color:var(--league-text)]">{member.teamName}</h3>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${roleBadgeClass(
                              member.role
                            )}`}
                          >
                            {member.role}
                          </span>
                          {member.userId === currentUserId ? (
                            <span className="rounded-full bg-[color:var(--league-success-soft)] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--league-success)]">
                              You
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-slate-600">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Joined</p>
                          <p className="mt-1 font-medium text-slate-700">
                            {new Date(member.joinedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">League</p>
                          <p className="mt-1 font-medium capitalize text-slate-700">{league.status}</p>
                        </div>
                      </div>
                      <div className="mt-5 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--league-text-muted)]">
                        <Link
                          href={`/leagues/${league.id}/teams/${member.userId}`}
                          className="inline-flex items-center gap-2 rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-3 py-2 transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--league-primary)]"
                        >
                          <span>Open roster</span>
                          <span aria-hidden="true" className="transition group-hover:translate-x-0.5">→</span>
                        </Link>
                        {isOwner && member.role !== 'owner' ? (
                          <button
                            type="button"
                            onClick={() =>
                              void updateMemberRole(
                                member.userId,
                                member.role === 'commissioner' ? 'manager' : 'commissioner'
                              )
                            }
                            disabled={updatingMemberRole === member.userId}
                            className="rounded-full border border-[color:var(--league-border)] px-3 py-2 text-[10px] font-semibold tracking-[0.12em] transition hover:bg-[color:var(--league-surface-muted)] disabled:opacity-50"
                          >
                            {updatingMemberRole === member.userId
                              ? 'Saving…'
                              : member.role === 'commissioner'
                                ? 'Remove commissioner'
                                : 'Make commissioner'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </LeagueTabFrame>
            )}

            {activeTab === 'roster' && (
              <LeagueTabFrame
                eyebrow="My squad"
                title="My Roster"
                description="Set your lineup, review your squad, and make fast changes without leaving the league workspace."
              >
                <MyTeamRosterManager
                  league={league}
                  members={members}
                  currentUserId={currentUserId}
                />
              </LeagueTabFrame>
            )}

            {activeTab === 'trades' && (
              <LeagueTradesClient
                leagueId={league.id}
                leagueName={league.name}
                preselectedIncomingPlayerId={searchParams?.get('tradePlayer') || undefined}
                preselectedRecipientUserId={searchParams?.get('tradeRecipient') || undefined}
                embedded
              />
            )}

            {activeTab === 'players' && (
              <PlayersPageClient players={[]} initialLeagueId={league.id} lockLeagueId embedded />
            )}

            {activeTab === 'waivers' && (
              <LeagueWaiversTab
                leagueId={league.id}
                members={members}
                preselectedClaimPlayerId={searchParams?.get('claimPlayer') || undefined}
                embedded
              />
            )}

            {activeTab === 'draft' && (
              <LeagueTabFrame
                eyebrow="Draft room"
                title="Draft"
                description="Everything tied to your league draft, from setup to live room status, sits in one place."
              >
                <div className="space-y-6">
                  <div className="rounded-[28px] border border-[color:var(--league-border)] bg-[color:var(--league-surface)] p-5 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--league-text-muted)]">
                          Setup checklist
                        </p>
                        <h3 className="mt-2 text-xl font-semibold text-[color:var(--league-text)]">
                          Get this league ready for draft night
                        </h3>
                        <p className="mt-2 max-w-2xl text-sm text-[color:var(--league-text-muted)]">
                          Work through the flow in order: fill the league, confirm scoring, schedule the draft, then create the room.
                        </p>
                      </div>
                      <Link
                        href={buildTabHref('settings')}
                        className="inline-flex items-center justify-center rounded-full border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-2 text-sm font-semibold text-[color:var(--league-text)] transition hover:border-[color:var(--league-accent)] hover:bg-[color:var(--league-accent-soft)]"
                      >
                        Review league settings
                      </Link>
                    </div>
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {setupSteps.map((step) => (
                        <div
                          key={step.id}
                          className="rounded-2xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] px-4 py-4"
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                                step.complete
                                  ? 'bg-[color:var(--league-success-soft)] text-[color:var(--league-success)]'
                                  : 'bg-[color:var(--league-warning-soft)] text-[color:var(--league-warning)]'
                              }`}
                            >
                              {step.complete ? '✓' : step.id === 'order' ? '!' : step.id === 'schedule' ? '3' : step.id === 'categories' ? '2' : '1'}
                            </span>
                            <p className="text-sm font-semibold text-[color:var(--league-text)]">
                              {step.title}
                            </p>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-[color:var(--league-text-muted)]">
                            {step.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <DraftManager league={league} members={members} currentUserId={currentUserId} />
                </div>
              </LeagueTabFrame>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-6">
                <LeagueTabFrame
                  eyebrow="League controls"
                  title="League Settings"
                  description="This is the authoritative setup surface for scoring categories, draft timing, and trade rules used across the league."
                >
                  <div className="space-y-6">
                    <div className="rounded-3xl border border-[color:var(--league-border)] bg-[color:var(--league-surface-muted)] p-5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--league-text-muted)]">
                        What saves here
                      </p>
                      <p className="mt-3 text-sm leading-6 text-[color:var(--league-text-muted)]">
                        Changes on this tab update the live league setup for league basics, capacity, scoring categories, draft defaults, roster rules, waiver policy, captain rules, and season structure. Draft order is managed from the Draft tab, and you can rotate the invite code here when you want to invalidate older links.
                      </p>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-950">League basics</h3>
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            Commissioners can update the league identity and visibility here. League capacity and invite-code rotation remain owner-only.
                          </p>
                        </div>
                        <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Mixed access
                        </span>
                      </div>
                      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label
                            htmlFor="setup-league-name"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            League name
                          </label>
                          <input
                            id="setup-league-name"
                            type="text"
                            value={setupLeagueName}
                            disabled={!canManageLeague}
                            onChange={(event) => setSetupLeagueName(event.target.value)}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="setup-league-type"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Privacy
                          </label>
                          <select
                            id="setup-league-type"
                            value={setupLeagueType}
                            disabled={!canManageLeague}
                            onChange={(event) => setSetupLeagueType(event.target.value as LeagueType)}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          >
                            <option value="private">Private</option>
                            <option value="public">Public</option>
                          </select>
                        </div>
                        <div className="md:col-span-2">
                          <label
                            htmlFor="setup-league-description"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Description
                          </label>
                          <textarea
                            id="setup-league-description"
                            value={setupDescription}
                            disabled={!canManageLeague}
                            onChange={(event) => setSetupDescription(event.target.value)}
                            rows={3}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="setup-max-teams"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Max teams {isOwner ? null : <span className="text-slate-400">(owner only)</span>}
                          </label>
                          <input
                            id="setup-max-teams"
                            type="number"
                            min={Math.max(4, members.length)}
                            max={20}
                            value={setupMaxTeams}
                            disabled={!canManageOwnerSettings}
                            onChange={(event) => setSetupMaxTeams(parseInt(event.target.value || '0', 10))}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                      </div>
                      <dl className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                            Invite code
                          </dt>
                          <dd className="mt-2 font-mono text-base font-semibold tracking-[0.18em] text-slate-700">
                            {league.code}
                          </dd>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                            Max teams
                          </dt>
                          <dd className="mt-2 text-base font-semibold text-slate-900">{setupMaxTeams}</dd>
                        </div>
                      </dl>
                      <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={setupRegenerateInviteCode}
                          onChange={(event) => setSetupRegenerateInviteCode(event.target.checked)}
                          disabled={!canManageOwnerSettings}
                          className="mt-1"
                        />
                        <span>
                          <span className="block font-semibold text-slate-900">
                            Generate a new invite code on save {!isOwner ? <span className="text-slate-400">(owner only)</span> : null}
                          </span>
                          <span className="mt-1 block text-slate-500">
                            Use this when you want to invalidate older share links and issue a fresh code to incoming managers.
                          </span>
                        </span>
                      </label>
                    </div>

                    {/* Scoring Categories */}
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <h3 className="mb-4 text-lg font-semibold text-slate-950">Scoring categories</h3>
                      <p className="mb-4 text-sm leading-6 text-slate-500">
                        Choose the stat categories that decide weekly matchups and season standings.
                      </p>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {(Object.keys(FANTASY_CATEGORIES) as FantasyCategoryKey[]).map((category) => {
                          const categoryData = FANTASY_CATEGORIES[category];
                          const selected = editableCategories.includes(category);
                          return (
                            <button
                              key={category}
                              type="button"
                              onClick={() => toggleCategory(category)}
                              disabled={!canManageLeague}
                              aria-pressed={selected}
                              className={`flex items-center rounded-2xl border px-3 py-3 text-left transition ${
                                selected
                                  ? 'border-[color:var(--league-primary)] bg-[color:var(--league-primary-soft)]'
                                  : 'border-slate-200 bg-slate-50'
                              } ${canManageLeague ? 'hover:border-[color:var(--league-accent)]' : 'cursor-default'}`}
                            >
                              <span className="text-sm font-medium text-slate-800">
                                {categoryData?.label || category}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-4 text-sm text-slate-500">
                        {editableCategories.length} categories selected.
                      </p>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <h3 className="mb-4 text-lg font-semibold text-slate-950">Draft setup</h3>
                      <p className="mb-4 text-sm leading-6 text-slate-500">
                        Save the league’s draft schedule and pick clock here. Then move to the Draft tab to review order and create the draft room.
                      </p>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <label
                            htmlFor="setup-draft-date"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Draft date and time
                          </label>
                          <input
                            id="setup-draft-date"
                            type="datetime-local"
                            value={setupDraftDate}
                            disabled={!canManageLeague}
                            onChange={(event) => setSetupDraftDate(event.target.value)}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="setup-draft-type"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Draft type
                          </label>
                          <select
                            id="setup-draft-type"
                            value={setupDraftType}
                            disabled={!canManageLeague}
                            onChange={(event) => setSetupDraftType(event.target.value as LeagueDraftType)}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          >
                            <option value="snake">Snake Draft</option>
                            <option value="linear">Linear Draft</option>
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor="setup-time-per-pick"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Time per pick
                          </label>
                          <select
                            id="setup-time-per-pick"
                            value={setupTimePerPick}
                            disabled={!canManageLeague}
                            onChange={(event) => setSetupTimePerPick(parseInt(event.target.value, 10))}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          >
                            <option value={60}>1 minute</option>
                            <option value={90}>1.5 minutes</option>
                            <option value={120}>2 minutes</option>
                            <option value={180}>3 minutes</option>
                            <option value={300}>5 minutes</option>
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor="setup-roster-size"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Total roster spots
                          </label>
                          <input
                            id="setup-roster-size"
                            type="number"
                            min={1}
                            value={setupRosterSize}
                            disabled={!canManageLeague}
                            onChange={(event) => setSetupRosterSize(parseInt(event.target.value || '0', 10))}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="setup-bench-size"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Bench spots
                          </label>
                          <input
                            id="setup-bench-size"
                            type="number"
                            min={0}
                            value={setupBenchSize}
                            disabled={!canManageLeague}
                            onChange={(event) => setSetupBenchSize(parseInt(event.target.value || '0', 10))}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700 md:col-span-3">
                          <input
                            type="checkbox"
                            checked={setupAllowAutoPick}
                            onChange={(event) => setSetupAllowAutoPick(event.target.checked)}
                            disabled={!canManageLeague}
                            className="mt-1"
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">Allow auto-pick on expired clocks</span>
                            <span className="mt-1 block text-slate-500">
                              When enabled, the live draft can make an automatic pick after a team lets its timer expire.
                            </span>
                          </span>
                        </label>
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700 md:col-span-3">
                          <input
                            type="checkbox"
                            checked={setupEnableReminders}
                            onChange={(event) => setSetupEnableReminders(event.target.checked)}
                            disabled={!canManageLeague}
                            className="mt-1"
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">Send draft reminders</span>
                            <span className="mt-1 block text-slate-500">
                              Save whether pre-draft reminders should be scheduled when the draft room is created.
                            </span>
                          </span>
                        </label>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <h3 className="mb-4 text-lg font-semibold text-slate-950">Captain rules</h3>
                      <p className="mb-4 text-sm leading-6 text-slate-500">
                        Control whether teams can assign captain and vice-captain multipliers during the season.
                      </p>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700 md:col-span-3">
                          <input
                            type="checkbox"
                            checked={setupEnableCaptainSystem}
                            onChange={(event) => setSetupEnableCaptainSystem(event.target.checked)}
                            disabled={!canManageLeague}
                            className="mt-1"
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">Enable captain system</span>
                            <span className="mt-1 block text-slate-500">
                              Let teams assign a captain and vice-captain and apply the saved multipliers below.
                            </span>
                          </span>
                        </label>
                        <div>
                          <label
                            htmlFor="captain-multiplier"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Captain multiplier
                          </label>
                          <input
                            id="captain-multiplier"
                            type="number"
                            min={1}
                            step="0.1"
                            value={setupCaptainMultiplier}
                            disabled={!canManageLeague}
                            onChange={(event) =>
                              setSetupCaptainMultiplier(Number(event.target.value || '1'))
                            }
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="vice-captain-multiplier"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Vice-captain multiplier
                          </label>
                          <input
                            id="vice-captain-multiplier"
                            type="number"
                            min={1}
                            step="0.1"
                            value={setupViceCaptainMultiplier}
                            disabled={!canManageLeague}
                            onChange={(event) =>
                              setSetupViceCaptainMultiplier(Number(event.target.value || '1'))
                            }
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <h3 className="mb-4 text-lg font-semibold text-slate-950">Season structure</h3>
                      <p className="mb-4 text-sm leading-6 text-slate-500">
                        Define the regular season length and playoff format used when league matchups and ladder projections are generated.
                      </p>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <label
                            htmlFor="season-weeks"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Regular season weeks
                          </label>
                          <input
                            id="season-weeks"
                            type="number"
                            min={1}
                            value={setupSeasonWeeks}
                            disabled={!canManageLeague}
                            onChange={(event) => setSetupSeasonWeeks(parseInt(event.target.value || '1', 10))}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="matchups-per-opponent"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Matchups per opponent
                          </label>
                          <select
                            id="matchups-per-opponent"
                            value={setupMatchupsPerOpponent}
                            disabled={!canManageLeague}
                            onChange={(event) =>
                              setSetupMatchupsPerOpponent((parseInt(event.target.value, 10) === 2 ? 2 : 1) as 1 | 2)
                            }
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          >
                            <option value={1}>Single round robin</option>
                            <option value={2}>Double round robin</option>
                          </select>
                        </div>
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={setupPlayoffsEnabled}
                            onChange={(event) => setSetupPlayoffsEnabled(event.target.checked)}
                            disabled={!canManageLeague}
                            className="mt-1"
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">Enable playoffs</span>
                            <span className="mt-1 block text-slate-500">
                              Add a playoff stage after the regular season schedule.
                            </span>
                          </span>
                        </label>
                        <div>
                          <label
                            htmlFor="playoff-teams"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Playoff teams
                          </label>
                          <input
                            id="playoff-teams"
                            type="number"
                            min={0}
                            max={setupMaxTeams}
                            value={setupPlayoffTeams}
                            disabled={!canManageLeague || !setupPlayoffsEnabled}
                            onChange={(event) => setSetupPlayoffTeams(parseInt(event.target.value || '0', 10))}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="playoff-leg-length"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Playoff leg length
                          </label>
                          <select
                            id="playoff-leg-length"
                            value={setupPlayoffLegLengthWeeks}
                            disabled={!canManageLeague || !setupPlayoffsEnabled}
                            onChange={(event) =>
                              setSetupPlayoffLegLengthWeeks(parseInt(event.target.value, 10))
                            }
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          >
                            <option value={1}>Single week</option>
                            <option value={2}>Two-week aggregate</option>
                          </select>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={setupPlayoffReseedEachRound}
                            onChange={(event) => setSetupPlayoffReseedEachRound(event.target.checked)}
                            disabled={!canManageLeague || !setupPlayoffsEnabled}
                            className="mt-1"
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">Reseed each round</span>
                            <span className="mt-1 block text-slate-500">
                              Re-seed surviving teams after every playoff round.
                            </span>
                          </span>
                        </label>
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={setupPlayoffIncludeConsolation}
                            onChange={(event) => setSetupPlayoffIncludeConsolation(event.target.checked)}
                            disabled={!canManageLeague || !setupPlayoffsEnabled}
                            className="mt-1"
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">Include consolation bracket</span>
                            <span className="mt-1 block text-slate-500">
                              Generate consolation matchups for teams that miss the finals.
                            </span>
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* Trade Settings */}
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <h3 className="mb-4 text-lg font-semibold text-slate-950">Trade settings</h3>
                      <p className="mb-4 text-sm leading-6 text-slate-500">
                        These controls define the active trade policy for the league.
                      </p>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <label
                            htmlFor="trade-limit"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Trade Limit
                          </label>
                          <input
                            id="trade-limit"
                            type="number"
                            value={setupTradeLimit}
                            onChange={(event) => setSetupTradeLimit(parseInt(event.target.value || '0', 10))}
                            disabled={!canManageLeague}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="trade-review"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Review Process
                          </label>
                          <select
                            id="trade-review"
                            value={setupTradeReview}
                            onChange={(event) =>
                              setSetupTradeReview(event.target.value as League['tradeSettings']['tradeReview'])
                            }
                            disabled={!canManageLeague}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          >
                            <option value="none">None</option>
                            <option value="admin">Admin Review</option>
                            <option value="veto">League Veto</option>
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor="trade-deadline"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Trade deadline
                          </label>
                          <input
                            id="trade-deadline"
                            type="date"
                            value={setupTradeDeadline}
                            onChange={(event) => setSetupTradeDeadline(event.target.value)}
                            disabled={!canManageLeague}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                      <h3 className="mb-4 text-lg font-semibold text-slate-950">Waiver settings</h3>
                      <p className="mb-4 text-sm leading-6 text-slate-500">
                        Configure the active waiver system, processing cadence, and acquisition rules used across the league.
                      </p>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <label
                            htmlFor="waiver-system"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Waiver system
                          </label>
                          <select
                            id="waiver-system"
                            value={setupWaiverSystem}
                            onChange={(event) => setSetupWaiverSystem(event.target.value as WaiverSystem)}
                            disabled={!canManageLeague}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          >
                            <option value="ROLLING_LIST">Rolling list</option>
                            <option value="FAAB">FAAB</option>
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor="waiver-priority-mode"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Priority mode
                          </label>
                          <select
                            id="waiver-priority-mode"
                            value={setupWaiverPriorityMode}
                            onChange={(event) =>
                              setSetupWaiverPriorityMode(event.target.value as WaiverPriorityMode)
                            }
                            disabled={!canManageLeague}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          >
                            <option value="ROLLING">Rolling</option>
                            <option value="REVERSE_LADDER">Reverse ladder</option>
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor="waiver-reset-policy"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Reset policy
                          </label>
                          <select
                            id="waiver-reset-policy"
                            value={setupWaiverResetPolicy}
                            onChange={(event) =>
                              setSetupWaiverResetPolicy(event.target.value as WaiverResetPolicy)
                            }
                            disabled={!canManageLeague}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          >
                            <option value="weekly">Weekly</option>
                            <option value="rolling">Rolling</option>
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor="waiver-period-hours"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Waiver period (hours)
                          </label>
                          <input
                            id="waiver-period-hours"
                            type="number"
                            min={1}
                            value={setupWaiverPeriodHours}
                            onChange={(event) =>
                              setSetupWaiverPeriodHours(parseInt(event.target.value || '0', 10))
                            }
                            disabled={!canManageLeague}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        {setupWaiverSystem === 'FAAB' ? (
                          <>
                            <div>
                              <label
                                htmlFor="waiver-faab-budget"
                                className="mb-1 block text-sm font-medium text-slate-700"
                              >
                                FAAB budget
                              </label>
                              <input
                                id="waiver-faab-budget"
                                type="number"
                                min={1}
                                value={setupWaiverFaabBudget}
                                onChange={(event) =>
                                  setSetupWaiverFaabBudget(parseInt(event.target.value || '0', 10))
                                }
                                disabled={!canManageLeague}
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor="waiver-minimum-bid"
                                className="mb-1 block text-sm font-medium text-slate-700"
                              >
                                Minimum bid
                              </label>
                              <input
                                id="waiver-minimum-bid"
                                type="number"
                                min={0}
                                value={setupWaiverMinimumBid}
                                onChange={(event) =>
                                  setSetupWaiverMinimumBid(parseInt(event.target.value || '0', 10))
                                }
                                disabled={!canManageLeague}
                                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                              />
                            </div>
                          </>
                        ) : null}
                        <div>
                          <label
                            htmlFor="waiver-max-week-acquisitions"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Max weekly acquisitions
                          </label>
                          <input
                            id="waiver-max-week-acquisitions"
                            type="number"
                            min={0}
                            value={setupWaiverMaxWeekAcquisitions}
                            onChange={(event) => setSetupWaiverMaxWeekAcquisitions(event.target.value)}
                            disabled={!canManageLeague}
                            placeholder="Unlimited"
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="waiver-max-season-acquisitions"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Max season acquisitions
                          </label>
                          <input
                            id="waiver-max-season-acquisitions"
                            type="number"
                            min={0}
                            value={setupWaiverMaxSeasonAcquisitions}
                            onChange={(event) => setSetupWaiverMaxSeasonAcquisitions(event.target.value)}
                            disabled={!canManageLeague}
                            placeholder="Unlimited"
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                          />
                        </div>
                      </div>
                      <div className="mt-4">
                        <label
                          htmlFor="cant-drop-list"
                          className="mb-1 block text-sm font-medium text-slate-700"
                        >
                          Cant-drop list
                        </label>
                        <textarea
                          id="cant-drop-list"
                          value={setupCantDropList}
                          onChange={(event) => setSetupCantDropList(event.target.value)}
                          disabled={!canManageLeague}
                          rows={4}
                          placeholder={'One player name per line\nExample Player'}
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 disabled:bg-slate-100"
                        />
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                          Add one player name per line. These players will be treated as protected from waiver-based drops.
                        </p>
                      </div>
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={setupWaiverMoveWinnerToBack}
                            onChange={(event) => setSetupWaiverMoveWinnerToBack(event.target.checked)}
                            disabled={!canManageLeague}
                            className="mt-1"
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">Move winner to back</span>
                            <span className="mt-1 block text-slate-500">
                              After a successful claim, move that team to the back of the waiver order.
                            </span>
                          </span>
                        </label>
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={setupWaiverAcquisitionLocked}
                            onChange={(event) => setSetupWaiverAcquisitionLocked(event.target.checked)}
                            disabled={!canManageLeague}
                            className="mt-1"
                          />
                          <span>
                            <span className="block font-semibold text-slate-900">Lock direct acquisitions</span>
                            <span className="mt-1 block text-slate-500">
                              Require waiver processing before players can be added directly.
                            </span>
                          </span>
                        </label>
                      </div>
                    </div>

                    {settingsMessage ? (
                      <div
                        className={`rounded-2xl border px-4 py-3 text-sm ${
                          settingsMessage === 'League setup saved.'
                          || settingsMessage === 'League setup saved. A new invite code is now active.'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-slate-50 text-slate-600'
                        }`}
                      >
                        {settingsMessage}
                      </div>
                    ) : null}

                    {isOwner && (
                      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                        <h3 className="mb-4 text-lg font-semibold text-slate-950">Commissioner access</h3>
                        <p className="mb-4 text-sm leading-6 text-slate-500">
                          Promote trusted managers to commissioner access when you want help running league setup, draft order, and draft administration. Only the owner can change commissioner roles.
                        </p>
                        <div className="space-y-3">
                          {members.map((member) => {
                            const isImmutableOwner = member.role === 'owner';
                            const nextRole =
                              member.role === 'commissioner' ? 'manager' : 'commissioner';

                            return (
                              <div
                                key={`commissioner-access-${member.id}`}
                                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{member.teamName}</p>
                                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                                    {member.role}
                                  </p>
                                </div>
                                {isImmutableOwner ? (
                                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    League owner
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void updateMemberRole(member.userId, nextRole)}
                                    disabled={updatingMemberRole === member.userId}
                                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                                  >
                                    {updatingMemberRole === member.userId
                                      ? 'Saving…'
                                      : member.role === 'commissioner'
                                        ? 'Remove commissioner'
                                        : 'Make commissioner'}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {canManageLeague && (
                      <div className="flex justify-end space-x-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditableCategories(savedCategories);
                            setSetupLeagueName(savedLeagueName);
                            setSetupLeagueType(savedLeagueType);
                            setSetupDescription(savedDescription);
                            setSetupMaxTeams(savedMaxTeams);
                            setSetupRegenerateInviteCode(false);
                            setSetupDraftDate(savedDraftDate);
                            setSetupDraftType(savedDraftType);
                            setSetupTimePerPick(savedTimePerPick);
                            setSetupAllowAutoPick(savedAllowAutoPick);
                            setSetupEnableReminders(savedEnableReminders);
                            setSetupRosterSize(savedRosterSize);
                            setSetupBenchSize(savedBenchSize);
                            setSetupEnableCaptainSystem(savedEnableCaptainSystem);
                            setSetupCaptainMultiplier(savedCaptainMultiplier);
                            setSetupViceCaptainMultiplier(savedViceCaptainMultiplier);
                            setSetupSeasonWeeks(savedSeasonWeeks);
                            setSetupMatchupsPerOpponent(savedMatchupsPerOpponent);
                            setSetupPlayoffsEnabled(savedPlayoffsEnabled);
                            setSetupPlayoffTeams(savedPlayoffTeams);
                            setSetupPlayoffLegLengthWeeks(savedPlayoffLegLengthWeeks);
                            setSetupPlayoffReseedEachRound(savedPlayoffReseedEachRound);
                            setSetupPlayoffIncludeConsolation(savedPlayoffIncludeConsolation);
                            setSetupTradeLimit(savedTradeLimit);
                            setSetupTradeReview(savedTradeReview);
                            setSetupTradeDeadline(savedTradeDeadline);
                            setSetupWaiverPeriodHours(savedWaiverPeriodHours);
                            setSetupWaiverResetPolicy(savedWaiverResetPolicy);
                            setSetupWaiverSystem(savedWaiverSystem);
                            setSetupWaiverPriorityMode(savedWaiverPriorityMode);
                            setSetupWaiverFaabBudget(savedWaiverFaabBudget);
                            setSetupWaiverMinimumBid(savedWaiverMinimumBid);
                            setSetupWaiverMaxWeekAcquisitions(savedWaiverMaxWeekAcquisitions);
                            setSetupWaiverMaxSeasonAcquisitions(savedWaiverMaxSeasonAcquisitions);
                            setSetupWaiverMoveWinnerToBack(savedWaiverMoveWinnerToBack);
                            setSetupWaiverAcquisitionLocked(savedWaiverAcquisitionLocked);
                            setSetupCantDropList(savedCantDropList);
                            setSettingsMessage(null);
                          }}
                          className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveLeagueSetup()}
                          disabled={savingSettings || !hasSetupChanges}
                          className="rounded-full bg-[color:var(--league-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[color:var(--league-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingSettings ? 'Saving…' : 'Save Changes'}
                        </button>
                      </div>
                    )}
                  </div>
                </LeagueTabFrame>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function LeagueTabFrame({
  eyebrow,
  title,
  description,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <LeagueViewHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        aside={aside}
      />
      {children}
    </div>
  );
}

// Team Roster Manager Component that integrates MyTeamPanel with league data
interface MyTeamRosterManagerProps {
  league: League;
  members: LeagueMember[];
  currentUserId?: string;
}

function MyTeamRosterManager({ league, members, currentUserId }: MyTeamRosterManagerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user: authUser, loading: authLoading } = useAuth();
  const [_selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [lastAction, setLastAction] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [roster, setRoster] = useState<Record<string, unknown> | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);

  // Get current user's team from league members
  const currentUserTeam = members.find((member) => member.userId === currentUserId);

  // Convert roster data to Team format for MyTeamPanel
  const team: Team | undefined = roster
    ? {
        id: String(roster.id),
        name: currentUserTeam?.teamName || 'My Team',
        players: Array.isArray((roster as { players?: Array<{ id: string | number }> }).players)
          ? (roster as { players?: Array<{ id: string | number }> }).players!.map((p) => String(p.id))
          : [],
      }
    : undefined;

  const getAuthToken = async (): Promise<string | null> => {
    if (!authUser) return null;
    if (typeof authUser.getIdToken !== 'function') return null;
    return await authUser.getIdToken();
  };

  const fetchRosterData = useCallback(async () => {
    if (!league?.id || !currentUserId) return;
    setLoading(true);
    try {
      const token = await getAuthToken();
      const response = await fetch(`/api/leagues/${league.id}/roster/${currentUserId}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (response.ok) {
        const rosterData = await response.json();
        const payload = rosterData?.data ?? rosterData;
        setRoster(payload?.roster ?? null);
        setPlayers(payload?.roster?.players || payload?.players || []);
      } else {
        const errorBody = await response.text().catch(() => '');
        console.error('Failed to fetch roster data', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody,
        });
        setLastAction('Failed to refresh roster');
      }
    } catch (error) {
      console.error('Error fetching roster:', error);
      setLastAction('Failed to refresh roster');
    } finally {
      setLoading(false);
    }
  }, [league?.id, currentUserId, authUser]);

  // Fetch roster data from real API
  useEffect(() => {
    if (!league?.id || !currentUserId || authLoading) return;
    if (!authUser && !isAuthBypassEnabled()) return;
    void fetchRosterData();
  }, [league?.id, currentUserId, authUser, authLoading, fetchRosterData]);

  const handlePlayerSelect = (player: Player) => {
    setSelectedPlayer(player);
    setLastAction(`Selected player: ${player.name}`);
  };

  const handleTeamAction = async (action: string, player?: Player) => {
    if (!league?.id || !currentUserId) return;

    setLoading(true);
    try {
      let actionData: Record<string, unknown> = {};
      const playerName = player ? player.name : 'this player';

      switch (action) {
        case 'view':
          if (player) {
            setSelectedPlayer(player);
            setLastAction(`Viewing ${player.name}`);
          }
          return;
        case 'captain':
          if (player) {
            const confirmed = window.confirm(`Set ${player.name} as captain?`);
            if (!confirmed) return;
            actionData = {
              actionType: 'SET_CAPTAIN',
              details: { playerId: player.id },
            };
            setLastAction(`Setting ${player.name} as captain...`);
          }
          break;
        case 'viceCaptain':
          if (player) {
            const confirmed = window.confirm(`Set ${player.name} as vice-captain?`);
            if (!confirmed) return;
            actionData = {
              actionType: 'SET_VICE_CAPTAIN',
              details: { playerId: player.id },
            };
            setLastAction(`Setting ${player.name} as vice-captain...`);
          }
          break;
        case 'optimize':
          if (!window.confirm('Optimize your lineup automatically?')) return;
          actionData = {
            actionType: 'OPTIMIZE_LINEUP',
            details: {},
          };
          setLastAction('Optimizing lineup...');
          break;
        case 'bench':
          if (!player) return;
          if (!window.confirm(`Move ${player.name} to your bench order?`)) return;
          setLastAction(`Moving ${player.name} to bench...`);
          {
            const rosterPlayers = players.map((p) => String(p.id));
            const targetId = String(player.id);
            if (!rosterPlayers.includes(targetId)) {
              setLastAction(`${player.name} is not in your active roster.`);
              return;
            }
            const nextOrder = [...rosterPlayers.filter((id) => id !== targetId), targetId];
            const rosterState = (roster || {}) as {
              captainId?: string | null;
              viceCaptainId?: string | null;
              benchOrder?: unknown;
            };
            const currentBenchOrder = Array.isArray(rosterState.benchOrder)
              ? rosterState.benchOrder.map(String)
              : [];
            const token = await getAuthToken();
            const benchResponse = await fetch(`/api/leagues/${league.id}/roster/${currentUserId}`, {
              method: 'PUT',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                playerIds: nextOrder,
                captainId: rosterState.captainId ?? undefined,
                viceCaptainId: rosterState.viceCaptainId ?? undefined,
                benchOrder: currentBenchOrder.length ? currentBenchOrder : undefined,
              }),
            });
            if (!benchResponse.ok) {
              const msg = await benchResponse.text().catch(() => '');
              setLastAction(msg || 'Failed to move player to bench');
              return;
            }
            await fetchRosterData();
            setLastAction(`${player.name} moved to bench.`);
            return;
          }
        case 'drop':
          if (player) {
            const confirmed = window.confirm(
              `Drop ${player.name}? This may place the player onto waivers based on league settings.`
            );
            if (!confirmed) return;
            actionData = {
              actionType: 'DROP_PLAYER',
              details: { playerId: player.id },
            };
            setLastAction(`Dropping ${player.name}...`);
          }
          break;
        case 'trade':
          if (player) {
            setLastAction(`Opening trade interface for ${player.name}...`);
            router.push(`${pathname}?tab=trades&tradePlayer=${encodeURIComponent(String(player.id))}`);
          } else {
            setLastAction('Opening trade interface...');
            router.push(`${pathname}?tab=trades`);
          }
          return;
        case 'waivers':
          setLastAction('Opening waiver claims...');
          router.push(`${pathname}?tab=waivers`);
          return;
        case 'resetLineup':
          if (!window.confirm('Reset lineup order to current default?')) return;
          setLastAction('Lineup reset requested.');
          return;
        case 'autoFillLineup':
          if (!window.confirm('Auto-fill lineup based on current roster order?')) return;
          actionData = {
            actionType: 'OPTIMIZE_LINEUP',
            details: {},
          };
          setLastAction('Auto-filling lineup...');
          break;
        case 'saveLineup':
          setLastAction('Lineup changes are saved automatically.');
          return;
        case 'confirmLineup':
          if (!window.confirm('Confirm your lineup for this round?')) return;
          setLastAction('Lineup confirmed.');
          return;
        default: {
          setLastAction(`${action} action ${playerName ? `for ${playerName}` : ''}`);
          return;
        }
      }

      // Submit team action to API
      const token = await getAuthToken();
      const response = await fetch(`/api/leagues/${league.id}/actions/${currentUserId}`, {
        credentials: 'include',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(actionData),
      });

      if (response.ok) {
        await response.json();
        await fetchRosterData();
        setLastAction(`${action} completed successfully`);
      } else {
        const error = await response.json();
        setLastAction(`Error: ${error.message || 'Action failed'}`);
      }
    } catch (error) {
      console.error('Team action failed:', error);
      setLastAction('Action failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    await fetchRosterData();
    setLastAction('Team data refreshed');
  };

  if (!currentUserId) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <p className="text-gray-600">Please sign in to manage your roster.</p>
      </div>
    );
  }

  if (!currentUserTeam) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <p className="text-gray-600">You are not a member of this league.</p>
      </div>
    );
  }

  if (loading && !roster) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[color:var(--league-primary)]"></div>
        <span className="ml-2 text-[color:var(--league-primary)]">Loading roster...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* MyTeamPanel Integration */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <MyTeamPanel
          team={team}
          players={players}
          onPlayerSelect={handlePlayerSelect}
          onTeamAction={handleTeamAction}
          onRefresh={handleRefresh}
          showAdvancedFeatures={true}
          sortByValue={true}
          maxHeight="none"
          isLoading={loading}
        />
      </div>

      {/* Additional League-specific Team Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <button
          onClick={() => handleTeamAction('optimize')}
          disabled={loading}
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
        >
          Optimize Lineup
        </button>
        <button
          onClick={() => handleTeamAction('trade')}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          Propose Trade
        </button>
        <button
          onClick={() => handleTeamAction('waivers')}
          disabled={loading}
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          Waiver Claims
        </button>
      </div>
    </div>
  );
}
