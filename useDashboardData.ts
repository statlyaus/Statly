import { useState, useEffect } from 'react';
import { fetchFromAPI } from '@/lib/api';
import type { Player } from '@/types';
import {
  mockStandings,
  mockRecentActivity,
  mockPlayerNews,
  type LeagueStanding,
  type RecentActivity,
  type PlayerNews,
} from '@/lib/mockDashboardData';
import { useAuth } from '@/app/Context/AuthContext';

export function useDashboardData() {
  const { user, loading: authLoading } = useAuth();
  const [topPlayers, setTopPlayers] = useState<Player[]>([]);
  const [standings, setStandings] = useState<LeagueStanding[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [playerNews, setPlayerNews] = useState<PlayerNews[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    const loadData = async () => {
      try {
        setLoading(true);
        const players = await fetchFromAPI<Player[]>('/api/players?limit=5&sortBy=fantasyPoints');
        setTopPlayers(players);

        const standingsWithUser = mockStandings.map((s) =>
          s.teamName === 'Your Team' ? { ...s, userId: user?.uid } : s
        );
        setStandings(standingsWithUser);
        setRecentActivity(mockRecentActivity);
        setPlayerNews(mockPlayerNews);
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user, authLoading]);

  return { user, topPlayers, standings, recentActivity, playerNews, loading: loading || authLoading };
}